import { createContext } from 'react';

export const FormContext = createContext({
  setLocation: () => {},
  setLot: () => {},
  setVendor: () => {},
  setBrand: () => {},
  setSpecies: () => {},
  setDescription: () => {},
  setGrade: () => {},
  setQuantity: () => {},
  setWeight: () => {},
  setPackdate: () => {},
  setTemp: () => {},
  setEst: () => {},
  setCurrentItem: () => {}
});