# IMDS Data Governance

Data Governance manages policy, approvals, evidence and recovery orchestration for IMDS products.

## Architectural boundary

The Super Admin stores:

- data classifications;
- retention policies;
- legal holds;
- export and deletion requests;
- backup metadata;
- restore operations;
- disaster recovery plans and tests;
- privacy request metadata;
- governance jobs and audit evidence.

The Super Admin does **not** store patient, clinical or product-domain records. Product adapters execute retention, export, deletion and restore commands inside the owning product.

## Main controls

### Retention

Each policy defines:

- organization and product scope;
- data classification;
- resource key;
- retention period;
- grace period;
- action: archive, anonymize, soft delete or hard delete;
- adapter command;
- policy version.

`legal_holds` always override retention and deletion.

### Export

Restricted exports use `data.export.restricted` in Security Approval Center. Completed exports store only destination reference, checksum, object count, size and expiry.

### Deletion

Deletion always requires `data.delete.organization`. The system checks active legal holds both when the request is created and when it is queued.

### Backup and restore

Backup bytes remain in external providers. `backup_assets` stores provider metadata, storage reference, immutability, retention, size and verification evidence.

Production restore requires `backup.restore.production` with two-person approval. Staging restore may be queued directly for validation.

### Disaster recovery

Each product/environment may define:

- RPO;
- RTO;
- runbook;
- communication plan;
- dependency map;
- test schedule;
- test evidence and corrective actions.

## Durable worker

`governance_jobs` is a service-role-only queue with:

- idempotency keys;
- worker leases;
- `FOR UPDATE SKIP LOCKED`;
- retries and dead-letter state;
- correlation IDs;
- append-only events.

## Schedulers

Recommended production cadence:

```text
schedule_retention_evaluations()   daily
expire_governance_records()        hourly
backup verification import        after every backup
DR test review                     monthly
```

## Production rollout

1. Apply `0019_data_governance.sql`.
2. Configure Product Adapter commands for retention, export and deletion.
3. Configure external backup providers and immutable storage.
4. Deploy the governance worker using service role credentials.
5. Schedule retention and expiry functions.
6. Test restricted export approval.
7. Test deletion blocked by legal hold.
8. Test staging restore and production restore approval.
9. Define RPO/RTO for every production product.
10. Run and document the first disaster recovery exercise.
