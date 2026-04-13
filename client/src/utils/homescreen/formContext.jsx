import { createContext } from "react";

export const FormContext = createContext({
  setFormData: () => {},
  setCurrentItem: () => {},
  onScannerAdd: () => {},
  onExportSelect: () => {},
  suggestions: { vendors: [], brands: [] },
});
