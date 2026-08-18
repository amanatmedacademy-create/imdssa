import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';

type JsonRecord = Record<string, unknown>;

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(payload));
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function bearer(req: IncomingMessage): string {
  const authorization = String(req.headers.authorization || '');
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
}
async function rawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
async function jsonBody(req: IncomingMessage): Promise<JsonRecord> {
  const raw = await rawBody(req);
  return raw ? JSON.parse(raw) as JsonRecord : {};
}
function secureHmac(raw: string, signature: string, secret: string): boolean {
  if (!raw || !signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('base64');
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
function cloudSignature(req: IncomingMessage): string {
  const direct = req.headers['content-hmac'] || req.headers['x-content-hmac'];
  return Array.isArray(direct) ? String(direct[0] || '') : String(direct || '');
}
function uuidOrNull(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

async function resolveInvoice(pool: Pool, input: { invoiceId?: string; invoiceNumber?: string }) {
  const rawId = text(input.invoiceId);
  const invoiceId = uuidOrNull(rawId);
  const invoiceNumber = text(input.invoiceNumber) || (invoiceId ? '' : rawId);
  if (!invoiceId && !invoiceNumber) return null;
  const result = await pool.query(`select i.*,o.external_key from app.billing_invoices i join app.organizations o on o.id=i.organization_id
    where ($1::uuid is not null and i.id=$1::uuid) or ($2<>'' and i.invoice_number=$2) limit 1`, [invoiceId,invoiceNumber]);
  return result.rows[0] ?? null;
}

async function recordPayment(pool: Pool, input: {
  invoiceId: string;
  method: string;
  amountKzt: number;
  externalReference: string;
  payerName?: string | null;
  receivedAt?: string | null;
  metadata?: JsonRecord;
}) {
  const receivedAt = text(input.receivedAt) && Number.isFinite(Date.parse(text(input.receivedAt))) ? new Date(text(input.receivedAt)).toISOString() : new Date().toISOString();
  const result = await pool.query(`select app.record_verified_billing_payment($1::uuid,$2,$3::numeric,$4,$5,$6::timestamptz,$7::jsonb) result`, [
    input.invoiceId,input.method,input.amountKzt,input.externalReference,text(input.payerName)||null,receivedAt,JSON.stringify(input.metadata || {}),
  ]);
  return result.rows[0]?.result as JsonRecord | undefined;
}

async function handleVerifiedFeed(req: IncomingMessage,res: ServerResponse,pool: Pool,method: string) {
  if (method !== 'POST') { json(res,405,{error:'METHOD_NOT_ALLOWED'}); return true; }
  const expected = String(process.env.IMDS_PLATFORM_CONTROL_TOKEN || '').trim();
  if (!expected || bearer(req) !== expected) { json(res,401,{error:'PLATFORM_CONTROL_UNAUTHORIZED'}); return true; }
  const payload = await jsonBody(req);
  const provider = text(payload.provider).toLowerCase();
  const eventReference = text(payload.eventReference || payload.externalReference);
  const status = text(payload.status || 'succeeded').toLowerCase();
  const methodName = text(payload.method || (provider === 'kaspi' ? 'kaspi' : provider === 'bank' || provider === 'halyk' ? 'bank_transfer' : 'other'));
  const amountKzt = number(payload.amountKzt);
  const invoice = await resolveInvoice(pool,{invoiceId:text(payload.invoiceId),invoiceNumber:text(payload.invoiceNumber)});
  if (!provider || !eventReference || !invoice || amountKzt == null || amountKzt <= 0) { json(res,400,{error:'INVALID_PROVIDER_PAYMENT'}); return true; }
  if (status !== 'succeeded' && status !== 'paid') { json(res,202,{accepted:true,applied:false,status}); return true; }
  try {
    const result = await recordPayment(pool,{
      invoiceId:invoice.id,method:methodName,amountKzt,externalReference:`${provider}:${eventReference}`,
      payerName:text(payload.payerName)||null,receivedAt:text(payload.receivedAt)||null,
      metadata:{source:'verified_provider_feed',provider,eventReference,raw:payload.metadata || {}},
    });
    await pool.query(`insert into app.billing_provider_events(provider,event_type,event_reference,invoice_id,payment_id,payload)
      values($1,'payment.succeeded',$2,$3::uuid,nullif($4,'')::uuid,$5::jsonb)
      on conflict(provider,event_type,event_reference) do nothing`, [provider,eventReference,invoice.id,text(result?.paymentId),JSON.stringify(payload)]);
    json(res,200,{ok:true,result}); return true;
  } catch (error) {
    json(res,409,{error:error instanceof Error ? error.message : String(error)}); return true;
  }
}

async function handleCloudPayments(req: IncomingMessage,res: ServerResponse,pool: Pool,event: string) {
  const secret = String(process.env.CLOUDPAYMENTS_API_SECRET || '').trim();
  if (!secret) { json(res,503,{code:13}); return true; }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const raw = req.method === 'GET' ? url.search.slice(1) : await rawBody(req);
  if (!secureHmac(raw,cloudSignature(req),secret)) { json(res,401,{code:13}); return true; }
  const params = Object.fromEntries(new URLSearchParams(raw).entries());
  const providerInvoiceId = text(params.InvoiceId);
  const invoice = await resolveInvoice(pool,{invoiceId:providerInvoiceId,invoiceNumber:providerInvoiceId});
  if (!invoice) { json(res,200,{code:10}); return true; }
  if (text(params.AccountId) && text(params.AccountId) !== text(invoice.external_key) && text(params.AccountId) !== text(invoice.organization_id)) { json(res,200,{code:10}); return true; }
  if (params.Amount && Math.abs(Number(params.Amount)-Number(invoice.total_kzt)) > 0.01) { json(res,200,{code:12}); return true; }
  if (params.Currency && text(params.Currency).toUpperCase() !== String(invoice.currency || 'KZT').toUpperCase()) { json(res,200,{code:12}); return true; }
  if (event === 'check') { json(res,200,{code:0}); return true; }
  const eventReference = text(params.TransactionId || params.SubscriptionId || params.InvoiceId);
  if (event === 'pay') {
    try {
      const amount = Number(params.Amount || invoice.total_kzt);
      const result = await recordPayment(pool,{
        invoiceId:invoice.id,method:'card',amountKzt:amount,externalReference:`cloudpayments:${eventReference}`,
        payerName:text(params.Name || params.Email)||null,receivedAt:new Date().toISOString(),
        metadata:{source:'cloudpayments_webhook',provider:'cloudpayments',transactionId:text(params.TransactionId)||null,subscriptionId:text(params.SubscriptionId)||null,cardType:text(params.CardType)||null,cardLastFour:text(params.CardLastFour)||null},
      });
      await pool.query(`insert into app.billing_provider_events(provider,event_type,event_reference,invoice_id,payment_id,payload)
        values('cloudpayments','pay',$1,$2::uuid,nullif($3,'')::uuid,$4::jsonb)
        on conflict(provider,event_type,event_reference) do nothing`, [eventReference,invoice.id,text(result?.paymentId),JSON.stringify(params)]);
      json(res,200,{code:0}); return true;
    } catch {
      json(res,200,{code:13}); return true;
    }
  }
  await pool.query(`insert into app.billing_provider_events(provider,event_type,event_reference,invoice_id,payload)
    values('cloudpayments',$1,$2,$3::uuid,$4::jsonb) on conflict(provider,event_type,event_reference) do nothing`, [event,eventReference,invoice.id,JSON.stringify(params)]);
  json(res,200,{code:0}); return true;
}

export async function handleProviderPayments(req: IncomingMessage,res: ServerResponse,pool: Pool,url: URL,method: string): Promise<boolean> {
  if (url.pathname === '/internal/billing/provider-payments') return handleVerifiedFeed(req,res,pool,method);
  const cloud = url.pathname.match(/^\/api\/webhooks\/cloudpayments\/(check|pay|fail|refund)$/);
  if (cloud && (method === 'POST' || method === 'GET')) return handleCloudPayments(req,res,pool,cloud[1]);
  return false;
}
