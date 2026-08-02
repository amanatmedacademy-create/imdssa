# IMDS Customer Success & Support

This module manages onboarding, customer health, support operations and SLA. It stores control-plane metadata only and must not copy patient, clinical or product-domain records into IMDS Super Admin.

## Scope

- customer success owner and lifecycle stage;
- weighted customer health score and risk level;
- onboarding plan and standard steps;
- centralized support ticket queue;
- priority-based SLA policies;
- ticket messages and append-only event history;
- internal support tasks and escalation;
- customer interactions and next actions;
- sanitized diagnostic snapshots;
- audit integration.

## Ticket lifecycle

```text
New -> Open -> In progress
                    -> Waiting customer
                    -> Waiting internal
                    -> Resolved -> Closed
                    -> Cancelled
```

## Standard SLA

| Priority | First response | Resolution |
|---|---:|---:|
| Low | 24 hours | 7 days |
| Normal | 8 hours | 48 hours |
| High | 2 hours | 16 hours |
| Urgent | 30 minutes | 4 hours |
| Critical | 10 minutes | 2 hours |

`refresh_support_sla()` marks breaches and creates an escalation task if no active recovery task exists.

## Customer health

`refresh_customer_health_scores()` combines:

- adoption: 30%;
- support quality: 25%;
- billing condition: 20%;
- platform reliability: 10%;
- onboarding completion: 15%.

Risk mapping:

```text
80-100 Healthy
60-79  Attention
40-59  At risk
0-39   Critical
```

The formula is a control-plane default. It can later be replaced with product usage metering and approved business rules.

## Diagnostics

`generate_support_diagnostic_snapshot()` collects only sanitized metadata:

- license status;
- product monitoring status;
- open incidents;
- integration connection health.

It explicitly excludes patient data, medical records, messages and product-domain transactions.

## Security

Browser clients receive read-only table access through RLS. Mutations use guarded RPCs.

Management roles:

- `platform_owner`;
- `super_admin`;
- `support_admin`;
- `sales_manager` for Customer Success actions.

Append-only history:

- ticket messages;
- ticket events;
- customer interactions;
- customer health history;
- diagnostic snapshots.

## Main RPCs

```text
create_support_ticket
assign_support_ticket
add_support_ticket_message
transition_support_ticket
create_onboarding_plan
update_onboarding_step
log_customer_interaction
refresh_support_sla
refresh_customer_health_scores
generate_support_diagnostic_snapshot
```

## Production rollout

1. Apply migration `0018_customer_success_support.sql`.
2. Assign Customer Success and Support owners.
3. Validate SLA values and working-hours policy.
4. Schedule `refresh_support_sla()` at least hourly.
5. Schedule `refresh_customer_health_scores()` daily.
6. Connect portal, email and WhatsApp ingestion through Integration Registry.
7. Configure notification delivery for SLA breaches and risk changes.
8. Confirm that diagnostic adapters never return patient or clinical payloads.
