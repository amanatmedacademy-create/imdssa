BEGIN;

-- Centralized IMDS Marketing commercial catalog.
-- Source of truth: IMDS Control Center. Prices intentionally use straight
-- monthly multiples for 3/6/12 month periods; no implicit discount is applied.

DO $$
DECLARE
  marketing_product_id uuid;
  start_plan_id uuid;
  pro_plan_id uuid;
  business_plan_id uuid;
  enterprise_plan_id uuid;
BEGIN
  SELECT id INTO marketing_product_id FROM app.products WHERE code='imds-marketing' LIMIT 1;
  IF marketing_product_id IS NULL THEN
    RAISE EXCEPTION 'imds-marketing product not found';
  END IF;

  INSERT INTO app.product_commercial_settings(product_id,default_trial_days,currency)
  VALUES(marketing_product_id,3,'KZT')
  ON CONFLICT(product_id) DO UPDATE SET default_trial_days=3,currency='KZT',updated_at=now();

  INSERT INTO app.product_plans(
    product_id,code,name,description,status,currency,trial_days,limits,metadata,
    pricing_mode,featured,sort_order,trial_mode,revision,updated_at
  ) VALUES (
    marketing_product_id,'start','IMDS Start','Для одной клиники и небольшой команды.','published','KZT',3,
    '{"clinics":1,"users":5,"leads":5000,"openTasks":1000,"integrations":5}'::jsonb,
    '{"catalogSource":"centralized-marketing-v1","pricingBasis":"monthly"}'::jsonb,
    'fixed',false,10,'product_default',1,now()
  )
  ON CONFLICT(product_id,code) DO UPDATE SET
    name=excluded.name,description=excluded.description,status='published',currency='KZT',trial_days=3,
    limits=excluded.limits,metadata=app.product_plans.metadata || excluded.metadata,pricing_mode='fixed',
    featured=false,sort_order=10,trial_mode='product_default',updated_at=now()
  RETURNING id INTO start_plan_id;

  INSERT INTO app.product_plans(
    product_id,code,name,description,status,currency,trial_days,limits,metadata,
    pricing_mode,featured,sort_order,trial_mode,revision,updated_at
  ) VALUES (
    marketing_product_id,'pro','IMDS Pro','Для растущей сети с расширенными лимитами.','published','KZT',3,
    '{"clinics":3,"users":20,"leads":25000,"openTasks":5000,"integrations":15}'::jsonb,
    '{"catalogSource":"centralized-marketing-v1","pricingBasis":"monthly"}'::jsonb,
    'fixed',true,20,'product_default',1,now()
  )
  ON CONFLICT(product_id,code) DO UPDATE SET
    name=excluded.name,description=excluded.description,status='published',currency='KZT',trial_days=3,
    limits=excluded.limits,metadata=app.product_plans.metadata || excluded.metadata,pricing_mode='fixed',
    featured=true,sort_order=20,trial_mode='product_default',updated_at=now()
  RETURNING id INTO pro_plan_id;

  INSERT INTO app.product_plans(
    product_id,code,name,description,status,currency,trial_days,limits,metadata,
    pricing_mode,featured,sort_order,trial_mode,revision,updated_at
  ) VALUES (
    marketing_product_id,'business','IMDS Business','Для многоклиничной сети и больших команд.','published','KZT',3,
    '{"clinics":10,"users":60,"leads":100000,"openTasks":20000,"integrations":40}'::jsonb,
    '{"catalogSource":"centralized-marketing-v1","pricingBasis":"organization"}'::jsonb,
    'fixed',false,30,'product_default',1,now()
  )
  ON CONFLICT(product_id,code) DO UPDATE SET
    name=excluded.name,description=excluded.description,status='published',currency='KZT',trial_days=3,
    limits=excluded.limits,metadata=app.product_plans.metadata || excluded.metadata,pricing_mode='fixed',
    featured=false,sort_order=30,trial_mode='product_default',updated_at=now()
  RETURNING id INTO business_plan_id;

  INSERT INTO app.product_plans(
    product_id,code,name,description,status,currency,trial_days,limits,metadata,
    pricing_mode,featured,sort_order,trial_mode,revision,updated_at
  ) VALUES (
    marketing_product_id,'enterprise','IMDS Enterprise','Для крупных сетей: индивидуальная конфигурация, лимиты и условия.','published','KZT',0,
    '{}'::jsonb,'{"catalogSource":"centralized-marketing-v1","salesContactRequired":true}'::jsonb,
    'request',false,40,'disabled',1,now()
  )
  ON CONFLICT(product_id,code) DO UPDATE SET
    name=excluded.name,description=excluded.description,status='published',currency='KZT',trial_days=0,
    metadata=app.product_plans.metadata || excluded.metadata,pricing_mode='request',featured=false,
    sort_order=40,trial_mode='disabled',updated_at=now()
  RETURNING id INTO enterprise_plan_id;

  INSERT INTO app.product_plan_prices(plan_id,months,amount_kzt)
  VALUES
    (start_plan_id,1,49900),(start_plan_id,3,149700),(start_plan_id,6,299400),(start_plan_id,12,598800),
    (pro_plan_id,1,99900),(pro_plan_id,3,299700),(pro_plan_id,6,599400),(pro_plan_id,12,1198800),
    (business_plan_id,1,249900),(business_plan_id,3,749700),(business_plan_id,6,1499400),(business_plan_id,12,2998800)
  ON CONFLICT(plan_id,months) DO UPDATE SET amount_kzt=excluded.amount_kzt;

  -- Keep the original Marketing commercial behavior: all top-level published
  -- Marketing modules are included in Start/Pro/Business. Plan differentiation
  -- is currently limits and commercial scale, not feature removal. Feature rows
  -- (for example voice transcription under Call Center) are not sold separately.
  INSERT INTO app.product_plan_modules(plan_id,module_id,mode,price_override_kzt)
  SELECT plan_id,m.id,'included',NULL
  FROM unnest(ARRAY[start_plan_id,pro_plan_id,business_plan_id,enterprise_plan_id]) AS plan_id
  JOIN app.modules m ON m.owner_product_id=marketing_product_id AND m.status='published'
  JOIN app.product_module_commercial c ON c.product_id=marketing_product_id AND c.module_id=m.id
  WHERE c.commercial_role='module'
  ON CONFLICT(plan_id,module_id) DO UPDATE SET mode='included',price_override_kzt=NULL;

  -- Card checkout becomes selectable only after real CloudPayments credentials
  -- are configured on the VPS. Bank transfer and Kaspi remain available now.
  UPDATE app.product_payment_methods
  SET enabled=true,updated_at=now()
  WHERE product_id=marketing_product_id AND method IN ('bank_transfer','kaspi');
END $$;

COMMIT;
