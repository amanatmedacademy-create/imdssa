import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';

type User = { id: string; global_role: string | null };
type Json = (res: ServerResponse, status: number, body: unknown) => void;

function canManage(user: User): boolean { return user.global_role === 'platform_owner' || user.global_role === 'platform_admin'; }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
}

export async function handleBillingReconciliationApi(args: { req: IncomingMessage; res: ServerResponse; pool: Pool; url: URL; method: string; user: User; json: Json }): Promise<boolean> {
  const { req,res,pool,url,method,user,json } = args;
  if (!url.pathname.startsWith('/api/v1/billing/')) return false;
  if (!canManage(user)) return false;

  if (url.pathname === '/api/v1/billing/payments' && method === 'POST') {
    const data = await body(req);
    const invoiceId = text(data.invoiceId);
    const methodName = text(data.method) || 'manual';
    const amountKzt = number(data.amountKzt);
    const allowed = new Set(['bank_transfer','kaspi','card','cash','manual','other']);
    if (!invoiceId || amountKzt == null || amountKzt <= 0 || !allowed.has(methodName)) {
      json(res,400,{error:'INVOICE_AMOUNT_AND_VALID_METHOD_REQUIRED'}); return true;
    }
    const externalReference = text(data.externalReference) || `control-center:${randomUUID()}`;
    const receivedAtRaw = text(data.receivedAt);
    const receivedAt = receivedAtRaw && Number.isFinite(Date.parse(receivedAtRaw)) ? new Date(receivedAtRaw).toISOString() : new Date().toISOString();
    try {
      const result = await pool.query(`select app.record_verified_billing_payment($1::uuid,$2,$3::numeric,$4,$5,$6::timestamptz,$7::jsonb) result`, [
        invoiceId,methodName,amountKzt,externalReference,text(data.payerName)||null,receivedAt,
        JSON.stringify({source:'control_center_manual_confirmation',actorUserId:user.id}),
      ]);
      const payment = result.rows[0]?.result;
      if (payment?.paymentId) await pool.query(`update app.billing_payments set recorded_by=$2 where id=$1::uuid and recorded_by is null`, [text(payment.paymentId),user.id]);
      await pool.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,after_state)
        values($1,'billing.payment.confirmed','billing_payment',$2,$3::jsonb)`, [user.id,text(payment?.paymentId),JSON.stringify(payment || {})]);
      json(res,201,payment); return true;
    } catch (error) {
      json(res,409,{error:error instanceof Error ? error.message : String(error)}); return true;
    }
  }

  if (url.pathname === '/api/v1/billing/refunds' && method === 'GET') {
    const organizationId = text(url.searchParams.get('organizationId'));
    const result = await pool.query(`select r.*,p.payment_number,p.method payment_method,i.invoice_number,o.name organization_name
      from app.billing_refunds r
      join app.billing_payments p on p.id=r.payment_id
      join app.billing_invoices i on i.id=r.invoice_id
      join app.organizations o on o.id=r.organization_id
      where ($1='' or r.organization_id=$1::uuid)
      order by r.received_at desc,r.created_at desc limit 500`, [organizationId]);
    json(res,200,{items:result.rows}); return true;
  }

  if (url.pathname === '/api/v1/billing/refunds' && method === 'POST') {
    const data = await body(req);
    const paymentId = text(data.paymentId);
    const invoiceId = text(data.invoiceId) || null;
    const amountKzt = number(data.amountKzt);
    const provider = text(data.provider || 'manual').toLowerCase();
    const externalReference = text(data.externalReference);
    if (!paymentId || amountKzt == null || amountKzt <= 0 || !externalReference) {
      json(res,400,{error:'PAYMENT_AMOUNT_AND_REFUND_REFERENCE_REQUIRED'}); return true;
    }
    const payment = await pool.query(`select id,external_reference,organization_id from app.billing_payments where id=$1 limit 1`, [paymentId]);
    if (!payment.rowCount) { json(res,404,{error:'PAYMENT_NOT_FOUND'}); return true; }
    const originalReference = text(payment.rows[0].external_reference);
    if (!originalReference) { json(res,409,{error:'PAYMENT_EXTERNAL_REFERENCE_REQUIRED'}); return true; }
    try {
      const result = await pool.query(`select app.record_verified_billing_refund($1,$2,$3,$4::numeric,$5::uuid,now(),$6::jsonb) result`, [
        provider,originalReference,externalReference,amountKzt,invoiceId,JSON.stringify({source:'control_center_manual_refund_confirmation',actorUserId:user.id}),
      ]);
      const refund = result.rows[0]?.result;
      await pool.query(`update app.billing_refunds set recorded_by=$2 where id=($1->>'refundId')::uuid`, [refund,user.id]);
      await pool.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,after_state)
        values($1,'billing.refund.confirmed','billing_refund',$2,$3::jsonb)`, [user.id,text(refund?.refundId),JSON.stringify(refund || {})]);
      json(res,201,refund); return true;
    } catch (error) {
      json(res,409,{error:error instanceof Error ? error.message : String(error)}); return true;
    }
  }

  if (url.pathname === '/api/v1/billing/reconciliation' && method === 'GET') {
    const runs = await pool.query(`select * from app.billing_reconciliation_runs order by started_at desc limit 50`);
    const issues = await pool.query(`select i.*,o.name organization_name,bi.invoice_number,bp.payment_number
      from app.billing_reconciliation_issues i
      left join app.organizations o on o.id=i.organization_id
      left join app.billing_invoices bi on bi.id=i.invoice_id
      left join app.billing_payments bp on bp.id=i.payment_id
      where i.status='open' order by case i.severity when 'error' then 0 when 'warning' then 1 else 2 end,i.created_at desc limit 200`);
    json(res,200,{runs:runs.rows,issues:issues.rows}); return true;
  }

  if (url.pathname === '/api/v1/billing/reconciliation/run' && method === 'POST') {
    const data = await body(req);
    const provider = text(data.provider) || null;
    try {
      const result = await pool.query(`select app.reconcile_billing_state($1) result`, [provider]);
      await pool.query(`insert into app.audit_logs(actor_user_id,action,target_type,target_id,after_state)
        values($1,'billing.reconciliation.run','billing_reconciliation',$2,$3::jsonb)`, [user.id,text(result.rows[0]?.result?.runId),JSON.stringify(result.rows[0]?.result || {})]);
      json(res,200,result.rows[0]?.result || {ok:true}); return true;
    } catch (error) {
      json(res,500,{error:error instanceof Error ? error.message : String(error)}); return true;
    }
  }

  return false;
}
