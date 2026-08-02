# IMDS Support Center

## Scope

The Support Center is the operational helpdesk inside IMDS Super Admin. It provides:

- organization- and product-linked tickets;
- priority and lifecycle management;
- first-response and resolution SLA deadlines;
- staff assignment;
- customer-visible replies;
- internal notes;
- searchable ticket queue;
- append-only lifecycle events;
- demo-mode storage when Supabase is not configured.

## Ticket lifecycle

```text
new -> open -> pending_customer
            -> pending_internal
            -> resolved -> closed
```

Closed tickets cannot receive new messages. Reopening can be performed by changing the status through the guarded update RPC.

## Default SLA

| Priority | First response | Resolution |
| --- | ---: | ---: |
| urgent | 15 minutes | 4 hours |
| high | 1 hour | 8 hours |
| normal | 4 hours | 24 hours |
| low | 8 hours | 48 hours |

The initial deadlines are calculated by `support_sla_deadlines`. Changing priority recalculates deadlines from the original creation time.

## Security model

- all tables have RLS enabled;
- platform staff receive read access;
- direct browser inserts, updates and deletes are revoked;
- mutations run through security-definer RPC functions;
- `platform_owner`, `super_admin`, `support_admin`, `technical_admin` and `sales_manager` can manage tickets;
- ticket events are append-only;
- internal notes cannot be authored as customer messages.

## Database objects

Migration `0017_support_center.sql` creates:

- `support_tickets`;
- `support_messages`;
- `support_events`;
- `support_ticket_overview`;
- `create_support_ticket`;
- `add_support_message`;
- `update_support_ticket`;
- `support_sla_deadlines`.

## Production activation

1. Apply migration `0017_support_center.sql`.
2. Confirm platform staff profiles and global roles exist.
3. Deploy the frontend build.
4. Open `/support` and test ticket creation, assignment, public reply, internal note and resolution.
5. Add email, WhatsApp or portal ingestion adapters as separate integration workers. They should call controlled server-side functions rather than writing directly to support tables.

## Deliberate boundaries

This release does not yet include external customer authentication, mailbox ingestion, WhatsApp ingestion, file attachments, CSAT surveys or business-hours calendars. The schema is designed so those capabilities can be added without replacing the ticket core.
