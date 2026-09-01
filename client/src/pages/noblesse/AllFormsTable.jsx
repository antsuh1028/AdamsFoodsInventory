import React, { useMemo, useState } from "react";
import {
  Box, Flex, Text, Button, Badge, Input, Select, IconButton, Tooltip,
} from "@chakra-ui/react";
import {
  TriangleUpIcon, TriangleDownIcon, ChevronLeftIcon, ChevronRightIcon,
  ChevronUpIcon, ChevronDownIcon, CloseIcon, SearchIcon,
} from "@chakra-ui/icons";
import { fmtDate, today } from "./shared";

// Sortable, filterable view of every registration form.
//
// Paginated by DAY rather than by row count: a shipment day is the unit people
// think in, and a fixed row count would split one day across two pages.

const DAYS_PER_PAGE = 7;

const COLUMNS = [
  { key: "lotNumber",          label: "Lot #",           filter: "text",   width: "110px" },
  { key: "dateReceived",       label: "Date Received",   filter: "text",   width: "150px", kind: "date" },
  { key: "vendor",             label: "Vendor",          filter: "select", width: "130px" },
  { key: "productDescription", label: "Product",         filter: "text",   width: "180px" },
  { key: "processingType",     label: "Type",            filter: "select", width: "170px" },
  { key: "spec",               label: "Spec",            filter: "text",   width: "80px",  align: "center" },
  { key: "originalWeight",     label: "Weight",          filter: "none",   width: "100px", align: "right", kind: "number" },
  { key: "actualYield",        label: "Yield %",         filter: "none",   width: "85px",  align: "right", kind: "number" },
  { key: "status",             label: "Status",          filter: "select", width: "110px", align: "center" },
  { key: "remarks",            label: "Remarks",         filter: "text",   width: "200px" },
];

const STATUS_LABEL = { in_progress: "In Progress", completed: "Completed" };

const cellText = (form, col) => {
  const raw = form[col.key];
  if (raw === null || raw === undefined || raw === "") return "";
  if (col.key === "status") return STATUS_LABEL[raw] || raw;
  return String(raw);
};

// Direction is applied inside rather than by negating the result, so blank
// cells sink to the bottom in BOTH directions instead of flipping to the top
// when you reverse the sort.
const compare = (a, b, col, dir) => {
  const av = a[col.key];
  const bv = b[col.key];
  const aEmpty = av === null || av === undefined || av === "";
  const bEmpty = bv === null || bv === undefined || bv === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const base = col.kind === "number"
    ? parseFloat(av) - parseFloat(bv)
    : String(av).localeCompare(String(bv)); // YYYY-MM-DD sorts correctly as text
  return dir === "asc" ? base : -base;
};

const AllFormsTable = ({ forms = [], onEdit }) => {
  const [sort, setSort] = useState({ key: "dateReceived", dir: "desc" });
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(0);
  // Hidden by default — most visits are just to read the list, and a permanent
  // row of empty inputs pushes the data down for no reason.
  const [showFilters, setShowFilters] = useState(false);

  const todayStr = today(); // Pacific business date

  const setFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0); // a filtered set has different days, so the old page index is meaningless
  };

  const clearFilters = () => { setFilters({}); setPage(0); };

  // Collapsing must not silently keep filtering. Hiding the row clears it; the
  // count on the button covers the case where they are left open and applied.
  const toggleFilters = () => {
    setShowFilters((open) => {
      if (open) clearFilters();
      return !open;
    });
  };
  const activeFilters = Object.entries(filters).filter(([, v]) => v);

  const toggleSort = (key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  };

  // Distinct values for the select filters, taken from the full set so the
  // options do not vanish as you narrow things down.
  const options = useMemo(() => {
    const out = {};
    for (const col of COLUMNS) {
      if (col.filter !== "select") continue;
      out[col.key] = [...new Set(forms.map((f) => f[col.key]).filter(Boolean))].sort();
    }
    return out;
  }, [forms]);

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v);
    if (!active.length) return forms;
    return forms.filter((form) =>
      active.every(([key, value]) => {
        const col = COLUMNS.find((c) => c.key === key);
        const cell = cellText(form, col);
        return col.filter === "select"
          ? String(form[key] ?? "") === value
          : cell.toLowerCase().includes(value.toLowerCase());
      })
    );
  }, [forms, filters]);

  // Pagination is always by received date, independent of the sort column, so
  // changing the sort reorders rows within a page instead of reshuffling pages.
  const days = useMemo(
    () => [...new Set(filtered.map((f) => f.dateReceived).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [filtered]
  );
  const totalPages = Math.max(1, Math.ceil(days.length / DAYS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pageDays = new Set(days.slice(safePage * DAYS_PER_PAGE, (safePage + 1) * DAYS_PER_PAGE));

  const visible = useMemo(() => {
    // Undated forms would otherwise never appear; they ride along on page 1.
    const rows = filtered.filter((f) => (f.dateReceived ? pageDays.has(f.dateReceived) : safePage === 0));
    const col = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[1];
    return [...rows].sort((a, b) => compare(a, b, col, sort.dir));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, safePage, sort, days]);

  const todayCount = filtered.filter((f) => f.dateReceived === todayStr).length;

  return (
    <Box>
      <Flex justify="space-between" align="center" mb={3} gap={3} wrap="wrap">
        <Flex align="center" gap={3} wrap="wrap">
          <Text fontSize="sm" color="gray.600">
            <strong>{filtered.length}</strong> form{filtered.length === 1 ? "" : "s"}
            {filtered.length !== forms.length && <> of {forms.length}</>}
          </Text>
          {todayCount > 0 && (
            <Badge colorScheme="green" borderRadius="full" px={2}>
              {todayCount} received today
            </Badge>
          )}
          <Button
            size="xs"
            variant={showFilters ? "solid" : "outline"}
            colorScheme={activeFilters.length ? "blue" : "gray"}
            leftIcon={<SearchIcon boxSize={3} />}
            rightIcon={showFilters ? <ChevronUpIcon /> : <ChevronDownIcon />}
            onClick={toggleFilters}
          >
            Filters{activeFilters.length > 0 && ` (${activeFilters.length})`}
          </Button>
          {activeFilters.length > 0 && (
            <Button size="xs" variant="ghost" leftIcon={<CloseIcon boxSize={2} />} onClick={clearFilters}>
              Clear
            </Button>
          )}
        </Flex>

        <Flex align="center" gap={1}>
          {onEdit && visible.length > 0 && (
            <Text fontSize="xs" color="gray.400" mr={3} display={{ base: "none", md: "block" }}>
              Double-click a row to edit
            </Text>
          )}
          <Text fontSize="xs" color="gray.500" mr={2}>
            {days.length === 0 ? "No dates" : `Days ${safePage * DAYS_PER_PAGE + 1}–${Math.min((safePage + 1) * DAYS_PER_PAGE, days.length)} of ${days.length}`}
          </Text>
          <IconButton aria-label="Previous days" icon={<ChevronLeftIcon />} size="xs" variant="outline"
            isDisabled={safePage === 0} onClick={() => setPage(safePage - 1)} />
          <IconButton aria-label="Next days" icon={<ChevronRightIcon />} size="xs" variant="outline"
            isDisabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)} />
        </Flex>
      </Flex>

      <Box overflowX="auto" maxH="62vh" overflowY="auto" border="1px solid" borderColor="gray.200" borderRadius="md">
        <Box as="table" width="100%" style={{ minWidth: "1150px", borderCollapse: "separate", borderSpacing: 0 }}>
          <Box as="thead" position="sticky" top={0} zIndex={2}>
            <Box as="tr">
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <Box as="th" key={col.key} bg="gray.100" borderBottom="1px solid" borderColor="gray.300"
                    px={3} py={2} textAlign={col.align || "left"} style={{ width: col.width }}>
                    <Tooltip label={`Sort by ${col.label}`} openDelay={500}>
                      <Flex as="button" onClick={() => toggleSort(col.key)} align="center" gap={1} width="100%"
                        justifyContent={col.align === "right" ? "flex-end" : col.align === "center" ? "center" : "flex-start"}
                        fontSize="xs" fontWeight="bold" textTransform="uppercase" letterSpacing="wide"
                        color={active ? "blue.700" : "gray.600"} _hover={{ color: "blue.600" }}>
                        {col.label}
                        {active
                          ? (sort.dir === "asc" ? <TriangleUpIcon boxSize={2.5} /> : <TriangleDownIcon boxSize={2.5} />)
                          : <Box boxSize={2.5} />}
                      </Flex>
                    </Tooltip>
                  </Box>
                );
              })}
            </Box>
            <Box as="tr" display={showFilters ? undefined : "none"}>
              {COLUMNS.map((col) => (
                <Box as="th" key={col.key} bg="gray.50" borderBottom="1px solid" borderColor="gray.200" px={2} py={1}>
                  {col.filter === "text" && (
                    <Input size="xs" variant="filled" bg="white" placeholder="Filter…"
                      value={filters[col.key] || ""} onChange={(e) => setFilter(col.key, e.target.value)} />
                  )}
                  {col.filter === "select" && (
                    <Select size="xs" variant="filled" bg="white"
                      value={filters[col.key] || ""} onChange={(e) => setFilter(col.key, e.target.value)}>
                      <option value="">All</option>
                      {(options[col.key] || []).map((v) => (
                        <option key={v} value={v}>{STATUS_LABEL[v] || v}</option>
                      ))}
                    </Select>
                  )}
                </Box>
              ))}
            </Box>
          </Box>

          <Box as="tbody">
            {visible.length === 0 ? (
              <Box as="tr">
                <Box as="td" colSpan={COLUMNS.length} px={3} py={6} textAlign="center" color="gray.400" fontSize="sm">
                  {forms.length === 0 ? "No registration forms yet." : "Nothing matches these filters."}
                </Box>
              </Box>
            ) : (
              visible.map((form, idx) => {
                const isToday = form.dateReceived === todayStr;
                return (
                  <Box as="tr" key={form.id}
                    bg={isToday ? "green.50" : idx % 2 === 0 ? "white" : "gray.50"}
                    _hover={{ bg: isToday ? "green.100" : "blue.50" }}
                    cursor={onEdit ? "pointer" : undefined}
                    title={onEdit ? "Double-click to edit" : undefined}
                    onDoubleClick={onEdit ? () => onEdit(form) : undefined}>
                    {COLUMNS.map((col, ci) => (
                      <Box as="td" key={col.key}
                        px={3} py={2} fontSize="sm"
                        borderBottom="1px solid" borderColor="gray.100"
                        textAlign={col.align || "left"}
                        // A green left edge makes today's intake scannable down
                        // the page without reading a single date.
                        borderLeft={ci === 0 && isToday ? "4px solid" : undefined}
                        borderLeftColor={ci === 0 && isToday ? "green.500" : undefined}
                        fontWeight={col.key === "lotNumber" ? "600" : "normal"}
                        color={col.key === "lotNumber" ? "blue.700" : "gray.700"}
                        whiteSpace={col.key === "remarks" ? "normal" : "nowrap"}>
                        {col.key === "status" ? (
                          <Badge colorScheme={form.status === "completed" ? "green" : "yellow"} fontSize="11px">
                            {STATUS_LABEL[form.status] || form.status}
                          </Badge>
                        ) : col.key === "dateReceived" ? (
                          <Flex align="center" gap={2}>
                            <Text>{fmtDate(form.dateReceived)}</Text>
                            {isToday && (
                              <Badge colorScheme="green" fontSize="9px" px={1.5} borderRadius="full">TODAY</Badge>
                            )}
                          </Flex>
                        ) : col.key === "originalWeight" ? (
                          form.originalWeight ? `${form.originalWeight} lb` : "—"
                        ) : col.key === "actualYield" ? (
                          form.actualYield ? `${form.actualYield}%` : "—"
                        ) : (
                          cellText(form, col) || "—"
                        )}
                      </Box>
                    ))}
                  </Box>
                );
              })
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default AllFormsTable;
