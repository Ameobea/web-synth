import type { FilterDesigner } from 'src/filterDesigner/FilterDesigner';

export const FilterDesignerStateByVcId: Map<string, FilterDesigner> = new Map();

export const cleanupFilterDesignerInst = (vcId: string) => {
  FilterDesignerStateByVcId.delete(vcId);
};
