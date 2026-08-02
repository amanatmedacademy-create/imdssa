# IMDS Billing Operations

Billing Operations extends subscriptions and licenses with a financial control plane. It does not replace accounting software and does not store product-domain transactions.

## Scope

- billing accounts by organization;
- invoices and immutable invoice numbers;
- invoice lines, discounts and taxes;
- incoming payments;
- payment-to-invoice allocation;
- receivables and overdue balances;
- refund requests and execution;
- four-eyes approval for refunds from 500,000 KZT;
- dunning cases;
- append-only billing events;
- audit integration.

## Document lifecycle

```text
Invoice: Draft -> Issued -> Partially paid -> Paid
                         -> Overdue -> Paid / Written off
                         -> Void

Payment: Pending -> Succeeded -> Partially refunded -> Refunded

Refund: Requested -> Pending approval -> Approved -> Processing -> Succeeded
                                      -> Rejected / Failed / Cancelled
```

Only draft invoices can be edited. Issued documents are corrected through credit notes or adjustments; they are not silently rewritten.

## Security model

Browser clients have read-only table access through RLS. Financial mutations use security-definer RPCs and are checked against `can_manage_billing()`.

Large refunds use the existing Security Approval Center policy:

```text
billing.refund.large
```

The requester cannot approve their own request. The refund cannot be completed until the related approval request is approved.

## Main RPCs

```text
create_invoice
add_invoice_line
issue_invoice
record_payment
allocate_payment
request_refund
complete_refund
refresh_billing_balances
```

## Balance refresh

`refresh_billing_balances()` should run daily or hourly through a trusted scheduler. It:

1. marks unpaid issued invoices as overdue;
2. recalculates organization balances;
3. recalculates overdue balances;
4. creates missing dunning cases.

## Production rollout

1. Apply migration `0017_billing_operations.sql`.
2. Confirm `finance_admin` and `super_admin` role assignments.
3. Configure invoice numbering and legal document templates.
4. Connect payment imports through Integration Registry.
5. Schedule `refresh_billing_balances()`.
6. Test large-refund approval end to end.
7. Add PDF/act generation only after legal templates are approved.

## Current limitation

The module records financial control-plane facts. Kazakhstan fiscal receipts, electronic invoices, tax reporting and bank reconciliation require separate approved integrations and are not implemented by this migration.
