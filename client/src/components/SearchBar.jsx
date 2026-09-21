import React, { useEffect, useRef, useState } from "react";
import {
  InputGroup, InputLeftElement, InputRightElement, Input, IconButton, Spinner,
} from "@chakra-ui/react";
import { SearchIcon, CloseIcon } from "@chakra-ui/icons";

// One search box for a tab's rows. The tab runs the search on the server, so
// typing is debounced rather than a round trip per keystroke. Escape or the ×
// clears it.
const SearchBar = ({
  onSearch, placeholder = "Search…", isSearching = false, delay = 300, maxW = "360px",
}) => {
  const [text, setText] = useState("");
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  // Only a CHANGE is reported. Typing a letter and deleting it again settles
  // on the search already showing, and reporting it would start a spinner for
  // a fetch that never runs. It also makes the empty box on mount a no-op.
  const lastSent = useRef("");
  useEffect(() => {
    const next = text.trim();
    if (next === lastSent.current) return undefined;
    const id = setTimeout(() => {
      lastSent.current = next;
      onSearchRef.current(next);
    }, delay);
    return () => clearTimeout(id);
  }, [text, delay]);

  return (
    <InputGroup size="sm" maxW={maxW} flex="1 1 220px">
      <InputLeftElement pointerEvents="none">
        <SearchIcon color="gray.400" />
      </InputLeftElement>
      {/* 16px on small screens: iOS zooms the page into any smaller field. */}
      <Input
        value={text}
        placeholder={placeholder}
        bg="white"
        autoComplete="off"
        fontSize={{ base: "16px", md: "sm" }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") setText(""); }}
      />
      {(text || isSearching) && (
        <InputRightElement>
          {isSearching ? (
            <Spinner size="xs" color="gray.400" />
          ) : (
            <IconButton aria-label="Clear search" size="xs" variant="ghost"
              icon={<CloseIcon boxSize={2} />} onClick={() => setText("")} />
          )}
        </InputRightElement>
      )}
    </InputGroup>
  );
};

export default SearchBar;
