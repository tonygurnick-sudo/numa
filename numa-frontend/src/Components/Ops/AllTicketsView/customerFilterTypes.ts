/**
 * Multi-field customer filter state.
 * Each key maps to an array of selected values (OR within field, AND between fields).
 */
export type CustomerFilterState = {
  customerIds: string[];
  includeNoCustomer: boolean;
  stages: string[];
  territories: string[];
  accountOwnerIds: string[];
  industries: string[];
  companySizes: string[];
};

export const EMPTY_CUSTOMER_FILTERS: CustomerFilterState = {
  customerIds: [],
  includeNoCustomer: false,
  stages: [],
  territories: [],
  accountOwnerIds: [],
  industries: [],
  companySizes: [],
};

export function hasActiveCustomerFilters(f: CustomerFilterState): boolean {
  return (
    f.customerIds.length > 0 ||
    f.includeNoCustomer ||
    f.stages.length > 0 ||
    f.territories.length > 0 ||
    f.accountOwnerIds.length > 0 ||
    f.industries.length > 0 ||
    f.companySizes.length > 0
  );
}

export function countActiveCustomerFilters(f: CustomerFilterState): number {
  let count = 0;
  if (f.customerIds.length > 0) count++;
  if (f.includeNoCustomer) count++;
  if (f.stages.length > 0) count++;
  if (f.territories.length > 0) count++;
  if (f.accountOwnerIds.length > 0) count++;
  if (f.industries.length > 0) count++;
  if (f.companySizes.length > 0) count++;
  return count;
}
