import React from "react";
import ItemDescriptionInput from "./ItemDescriptionInput";

// A customer, picked from the customer list or typed.
const CustomerInput = (props) => (
  <ItemDescriptionInput listId="customers" placeholder="e.g. SHABUYA"
    endpoint="/customers" allLabel="All customers" notOnList="Not on the customer list"
    {...props} />
);

export default CustomerInput;
