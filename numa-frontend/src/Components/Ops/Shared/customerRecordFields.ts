import type {
  Customer,
  CustomerRecordConfig,
  CustomerRecordLayout,
  CrmConfig,
  UpdateCustomerPayload,
} from '../../../types/ops';

/**
 * Field ids for the built-in Customer record fields. A built-in id is the
 * Customer property name itself (e.g. "companyName"). Anything not in this
 * set is treated as a custom field id pointing at a FieldDefinition, with
 * its value stored on customer.customFields[id].
 */
export type BuiltinFieldKind =
  | 'text'
  | 'textarea'
  | 'url'
  | 'date'
  | 'currency'
  | 'select-industry'
  | 'select-territory'
  | 'select-owner'
  | 'select-lifecycle'
  | 'select-contract-term'
  | 'product-list';

export interface BuiltinFieldMeta {
  /** Matches the Customer property name. */
  id: keyof Customer | 'ownerId' | 'lifecycleStage';
  /** i18n key resolved against the `ops` namespace. */
  labelKey: string;
  kind: BuiltinFieldKind;
}

/**
 * Registry of built-in customer fields. Order here is informational —
 * actual rendering order comes from CrmConfig.customerRecord.sections.
 */
export const BUILTIN_CUSTOMER_FIELDS: Record<string, BuiltinFieldMeta> = {
  companyName: { id: 'companyName', labelKey: 'common.name', kind: 'text' },
  industry: { id: 'industry', labelKey: 'crm.industry', kind: 'select-industry' },
  companySize: { id: 'companySize', labelKey: 'crm.companySize', kind: 'text' },
  website: { id: 'website', labelKey: 'crm.website', kind: 'url' },
  territory: { id: 'territory', labelKey: 'crm.territory', kind: 'select-territory' },
  source: { id: 'source', labelKey: 'crm.source', kind: 'text' },
  ownerId: { id: 'ownerId', labelKey: 'crm.owner', kind: 'select-owner' },
  lifecycleStage: { id: 'lifecycleStage', labelKey: 'crm.lifecycleStage', kind: 'select-lifecycle' },
  contractValue: { id: 'contractValue', labelKey: 'crm.contractValue', kind: 'currency' },
  contractTerm: { id: 'contractTerm', labelKey: 'crm.contractTerm', kind: 'select-contract-term' },
  contractStartDate: { id: 'contractStartDate', labelKey: 'crm.contractStart', kind: 'date' },
  renewalDate: { id: 'renewalDate', labelKey: 'crm.renewalDate', kind: 'date' },
  products: { id: 'products', labelKey: 'crm.products', kind: 'product-list' },
  productNotes: { id: 'productNotes', labelKey: 'crm.productNotes', kind: 'textarea' },
};

export const isBuiltinField = (fieldId: string): boolean =>
  Object.prototype.hasOwnProperty.call(BUILTIN_CUSTOMER_FIELDS, fieldId);

/**
 * Resolves the display label for a built-in customer field. Returns the
 * admin-set override when present and non-empty; otherwise the i18n
 * default for the field. `overrides` is `crmConfig.builtinFieldLabels`.
 */
export const resolveBuiltinFieldLabel = (
  overrides: Record<string, string> | null | undefined,
  fieldId: string,
  t: (key: string) => string
): string => {
  const meta = BUILTIN_CUSTOMER_FIELDS[fieldId];
  if (!meta) return fieldId;
  const override = overrides?.[fieldId];
  if (typeof override === 'string' && override.trim() !== '') return override;
  return t(meta.labelKey);
};

/**
 * Default customer record layout — used when the CRM config predates
 * the customerRecord feature (existing clients). Mirrors
 * seed-ops-config DEFAULT_CRM_CONFIG.customerRecord.
 */
export const DEFAULT_CUSTOMER_RECORD: CustomerRecordConfig = {
  sections: [
    {
      id: 'section-company-details',
      name: 'Company Details',
      fieldIds: [
        'companyName',
        'industry',
        'companySize',
        'website',
        'territory',
        'source',
        'ownerId',
        'lifecycleStage',
      ],
    },
    {
      id: 'section-contract',
      name: 'Contract',
      fieldIds: ['contractValue', 'contractTerm', 'contractStartDate', 'renewalDate', 'products', 'productNotes'],
    },
  ],
};

/**
 * Resolves the customer record layout, falling back to the default when
 * CrmConfig doesn't have one yet (e.g. existing client whose seed ran
 * before the feature landed).
 */
export const resolveCustomerRecord = (crmConfig: CrmConfig | null | undefined): CustomerRecordConfig => {
  const existing = crmConfig?.customerRecord;
  if (existing && existing.sections && existing.sections.length > 0) return existing;
  return DEFAULT_CUSTOMER_RECORD;
};

/** Defaults preserve the previous hard-coded behaviour. */
export const DEFAULT_CUSTOMER_RECORD_LAYOUT: Required<CustomerRecordLayout> = {
  columnsPerSection: 3,
  density: 'compact',
  defaultSectionsExpanded: false,
  labelPosition: 'above',
};

export const resolveCustomerRecordLayout = (
  crmConfig: CrmConfig | null | undefined
): Required<CustomerRecordLayout> => ({
  ...DEFAULT_CUSTOMER_RECORD_LAYOUT,
  ...(crmConfig?.layout ?? {}),
});

/**
 * Reads a field's current value from a customer, whether it's a built-in
 * property or a custom field stored on customer.customFields.
 */
export const getCustomerFieldValue = (customer: Customer, fieldId: string): unknown => {
  if (isBuiltinField(fieldId)) {
    return (customer as unknown as Record<string, unknown>)[fieldId];
  }
  return customer.customFields?.[fieldId];
};

/**
 * Builds an UpdateCustomerPayload that writes the given field. Built-ins
 * land at the top level of the payload; custom fields are merged into the
 * existing customFields bag (backend replaces the whole object).
 */
export const buildFieldUpdatePayload = (customer: Customer, fieldId: string, value: unknown): UpdateCustomerPayload => {
  if (isBuiltinField(fieldId)) {
    return { [fieldId]: value } as unknown as UpdateCustomerPayload;
  }
  return {
    customFields: {
      ...(customer.customFields ?? {}),
      [fieldId]: value,
    },
  };
};

/**
 * Merges a batch of field updates into a single payload. Used when a
 * whole section is saved at once (Edit → Save flow).
 */
export const buildSectionUpdatePayload = (
  customer: Customer,
  updates: Record<string, unknown>
): UpdateCustomerPayload => {
  const payload: Record<string, unknown> = {};
  const customFields: Record<string, unknown> = { ...(customer.customFields ?? {}) };
  let touchedCustomFields = false;

  for (const [fieldId, value] of Object.entries(updates)) {
    if (isBuiltinField(fieldId)) {
      payload[fieldId] = value;
    } else {
      customFields[fieldId] = value;
      touchedCustomFields = true;
    }
  }

  if (touchedCustomFields) {
    payload.customFields = customFields;
  }

  return payload as UpdateCustomerPayload;
};
