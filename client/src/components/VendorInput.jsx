import React, { useEffect, useState } from "react";
import { Box, Input } from "@chakra-ui/react";
import axiosInstance from "../utils/axiosInstance";

// A vendor field that suggests the spellings already in use.
//
// THE PROBLEM IT SOLVES. Typed free-hand, one company arrives as several
// vendors: production holds ADAMSFOODS, ADAMS FOOD, ADAMSFOOD and AdamsFoods,
// which no filter, grouping or total will ever join up. Nothing is wrong with
// any single record — it only shows up later, when a vendor's figures are
// split across four rows that look like four suppliers.
//
// SUGGESTED, NOT ENFORCED — the user's call, and the right one. A closed list
// breaks the day a new supplier turns up, and an operator who cannot type the
// name will put it somewhere worse or leave it blank. Making the consistent
// spelling the easiest thing to pick is enough.
//
// Built on a native <datalist> rather than a combobox: it is the one control
// that suggests without capturing. Typing stays typing — no dropdown stealing
// Enter, no focus trap, no keyboard behaviour to get wrong on an iPad. That
// matters on the scanning screen, where a control that swallows Enter would
// swallow scans (CLAUDE.md §4).
//
// The list is a cache of what has been typed before, not a registry: it is
// fetched once per mount and never written to. Failing to load it costs the
// suggestions and nothing else — the field is a plain input either way.
const VendorInput = ({ value, onChange, listId = "vendor-suggestions", ...rest }) => {
  const [vendors, setVendors] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axiosInstance.get("/vendors");
        if (!cancelled) setVendors(data || []);
      } catch {
        // Suggestions are a convenience. Losing them must not stop anyone
        // typing a vendor, so this is swallowed deliberately.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Box position="relative" width="100%">
      <Input {...rest} list={listId} value={value} onChange={onChange} />
      <datalist id={listId}>
        {vendors.map((v) => (
          <option key={v.vendor} value={v.vendor} />
        ))}
      </datalist>
    </Box>
  );
};

export default VendorInput;
