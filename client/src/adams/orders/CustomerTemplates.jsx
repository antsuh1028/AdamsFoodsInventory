import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Flex, Text, Button, Input, Select, Badge, Spinner, IconButton, Grid, useToast } from "@chakra-ui/react";
import { ArrowUpIcon, ArrowDownIcon, CloseIcon } from "@chakra-ui/icons";
import axiosInstance from "../../utils/axiosInstance";
import { DAYS } from "./orderMath";

const errText = (err) => err.response?.data?.error || err.message;
const cell = { px: 2, py: 1, borderTop: "1px solid", borderColor: "gray.100" };

// Admin: the order workbook in, and each customer's template kept up to date.
const ImportWorkbook = ({ onDone }) => {
  const toast = useToast();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);

  const send = async (dry, f = file) => {
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", f);
      const { data } = await axiosInstance.post(`/af-customers/import${dry ? "?dryRun=1" : ""}`, body);
      if (dry) setPlan(data);
      else {
        toast({ status: "success", position: "top", duration: 5000, title: "Workbook imported",
          description: `${data.customers.filter((c) => !c.action.startsWith("kept")).length} templates, ${data.items.new} new item codes.` });
        setPlan(null); setFile(null);
        onDone();
      }
    } catch (err) {
      toast({ status: "error", position: "top", duration: 7000, isClosable: true, title: "Could not read that workbook", description: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  const count = (a) => (plan ? plan.customers.filter((c) => c.action.startsWith(a)).length : 0);
  return (
    <Box p={3} border="1px solid" borderColor="gray.200" borderRadius="md" mb={3} bg="gray.50">
      <Text fontWeight="bold" fontSize="sm" mb={1}>Import the order workbook</Text>
      <Text fontSize="xs" color="gray.600" mb={2}>
        Each customer tab&apos;s newest order becomes that customer&apos;s template, with its prices. Every product line
        becomes an item code. A template changed here since that order was written is kept.
      </Text>
      <Flex gap={2} align="center" wrap="wrap">
        <input ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files[0]; if (f) { setFile(f); send(true, f); } e.target.value = ""; }} />
        <Button size="sm" onClick={() => fileRef.current.click()} isLoading={busy && !plan}>Choose AF_ORDER SHEET .xlsx…</Button>
        {file && <Text fontSize="xs" color="gray.600">{file.name}</Text>}
      </Flex>
      {plan && (
        <Box mt={3}>
          <Text fontSize="sm">
            <b>{plan.customers.length}</b> customer tabs: <b>{count("new")}</b> new, <b>{count("replaced")}</b> replaced,
            {" "}<b>{count("kept")}</b> kept. <b>{plan.items.new}</b> new item codes of {plan.items.inFile}.
          </Text>
          <Box maxH="180px" overflowY="auto" mt={2} fontSize="xs" border="1px solid" borderColor="gray.200" bg="white">
            {plan.customers.map((c) => (
              <Flex key={c.name} px={2} py={0.5} gap={2} borderBottom="1px solid" borderColor="gray.100">
                <Text flex="1">{c.name}</Text>
                <Text color="gray.500">{c.lines} lines, {c.priced} priced{c.from ? `, ${c.from}` : ""}</Text>
                <Badge colorScheme={c.action === "new" ? "green" : c.action === "replaced" ? "blue" : "gray"} fontSize="9px">{c.action}</Badge>
              </Flex>
            ))}
          </Box>
          <Flex gap={2} mt={2}>
            <Button size="sm" colorScheme="blue" isLoading={busy} onClick={() => send(false)}>Import</Button>
            <Button size="sm" variant="ghost" onClick={() => { setPlan(null); setFile(null); }}>Cancel</Button>
          </Flex>
        </Box>
      )}
    </Box>
  );
};

// One customer's heading and template lines, edited and saved whole.
const TemplateEditor = ({ customerId, onBack }) => {
  const toast = useToast();
  const [c, setC] = useState(null);
  const [adding, setAdding] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    axiosInstance.get(`/af-customers/${customerId}`).then(({ data }) => setC(data))
      .catch((err) => toast({ status: "error", title: "Could not load that customer", description: errText(err), position: "top" }));
  }, [customerId, toast]);

  useEffect(() => {
    const q = adding.trim();
    if (q.length < 2) { setHits([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      axiosInstance.get("/af-items", { params: { q, limit: 30 } }).then(({ data }) => { if (live) setHits(data); }).catch(() => {});
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [adding]);

  if (!c) return <Flex justify="center" py={8}><Spinner /></Flex>;
  const setLine = (i, patch) => setC({ ...c, lines: c.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const move = (i, d) => {
    const lines = [...c.lines];
    const j = i + d;
    if (j < 0 || j >= lines.length) return;
    [lines[i], lines[j]] = [lines[j], lines[i]];
    setC({ ...c, lines });
  };
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await axiosInstance.put(`/af-customers/${customerId}`, c);
      setC(data);
      toast({ status: "success", title: `${data.name} saved`, position: "top", duration: 2500 });
    } catch (err) {
      toast({ status: "error", title: "Could not save", description: errText(err), position: "top", duration: 6000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Flex mb={3} gap={2} align="center">
        <Button size="sm" variant="ghost" onClick={onBack}>← Customers</Button>
        <Text fontWeight="bold" fontSize="lg">{c.name}</Text>
        {c.templateFrom && <Text fontSize="xs" color="gray.500">template as of {c.templateFrom}</Text>}
      </Flex>
      <Grid templateColumns={{ base: "1fr", md: "110px 1fr 60px 140px" }} gap={2} alignItems="center" mb={3}>
        <Text fontSize="sm" fontWeight="bold">Name on sheet</Text>
        <Input size="sm" value={c.displayName || ""} onChange={(e) => setC({ ...c, displayName: e.target.value })} />
        <Text fontSize="sm" fontWeight="bold">Due</Text>
        <Select size="sm" value={c.dueDay || ""} placeholder="—" onChange={(e) => setC({ ...c, dueDay: e.target.value })}>
          {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <Text fontSize="sm" fontWeight="bold">Ship/BL To</Text>
        <Input size="sm" gridColumn={{ md: "2 / -1" }} value={c.shipTo || ""} onChange={(e) => setC({ ...c, shipTo: e.target.value })} />
      </Grid>
      <Box overflowX="auto" border="1px solid" borderColor="gray.200" borderRadius="md" mb={3}>
        <Box as="table" width="100%" minWidth="620px" fontSize="sm" style={{ borderCollapse: "collapse" }}>
          <Box as="thead" bg="gray.50">
            <tr>{["Code", "Tag", "Description", "$/lb", ""].map((h) => (
              <Box as="th" key={h} px={2} py={1.5} textAlign="left" fontSize="xs" color="gray.500" textTransform="uppercase">{h}</Box>
            ))}</tr>
          </Box>
          <tbody>
            {c.lines.map((l, i) => (
              <tr key={`${l.code}-${i}`}>
                <Box as="td" {...cell} fontFamily="mono" fontWeight="bold" width="80px">{l.code}</Box>
                <Box as="td" {...cell} width="70px">
                  <Input size="xs" value={l.tag || ""} onChange={(e) => setLine(i, { tag: e.target.value.toUpperCase() })} />
                </Box>
                <Box as="td" {...cell}>
                  <Input size="xs" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                </Box>
                <Box as="td" {...cell} width="84px">
                  <Input size="xs" textAlign="right" inputMode="decimal" value={l.price ?? ""} placeholder="—"
                    onChange={(e) => setLine(i, { price: e.target.value.replace(/[^\d.]/g, "") })} />
                </Box>
                <Box as="td" {...cell} width="96px" whiteSpace="nowrap">
                  <IconButton aria-label="Up" icon={<ArrowUpIcon />} size="xs" variant="ghost" onClick={() => move(i, -1)} />
                  <IconButton aria-label="Down" icon={<ArrowDownIcon />} size="xs" variant="ghost" onClick={() => move(i, 1)} />
                  <IconButton aria-label="Remove" icon={<CloseIcon />} size="xs" variant="ghost" colorScheme="red"
                    onClick={() => setC({ ...c, lines: c.lines.filter((_, j) => j !== i) })} />
                </Box>
              </tr>
            ))}
          </tbody>
        </Box>
      </Box>
      <Input size="sm" mb={1} placeholder="Add an item: search code or description…" value={adding} onChange={(e) => setAdding(e.target.value)} />
      <Flex direction="column" maxH="180px" overflowY="auto" mb={3}>
        {hits.map((it) => (
          <Button key={it.itemId} size="sm" variant="ghost" justifyContent="flex-start" fontWeight="normal"
            onClick={() => { setC({ ...c, lines: [...c.lines, { code: it.code, tag: it.tag, description: it.description, price: "" }] }); setAdding(""); }}>
            <Text as="span" fontFamily="mono" fontWeight="bold" mr={2}>{it.code}</Text>{it.description}
          </Button>
        ))}
      </Flex>
      <Button size="sm" colorScheme="blue" isLoading={busy} onClick={save}>Save template</Button>
    </Box>
  );
};

/** Admin: customers, their templates, and the workbook import. */
const CustomerTemplates = ({ onBack }) => {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    axiosInstance.get("/af-customers").then(({ data }) => setList(data))
      .catch((err) => { setList([]); toast({ status: "error", title: "Could not load customers", description: errText(err), position: "top" }); });
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  if (open) return <TemplateEditor customerId={open} onBack={() => { setOpen(null); load(); }} />;
  const t = q.trim().toUpperCase();
  const shown = (list || []).filter((c) => !t || c.name.toUpperCase().includes(t) || (c.displayName || "").toUpperCase().includes(t));
  return (
    <Box>
      <Flex mb={3} gap={2} align="center">
        <Button size="sm" variant="ghost" onClick={onBack}>← Orders</Button>
        <Text fontWeight="bold" fontSize="lg">Customers &amp; templates</Text>
      </Flex>
      <ImportWorkbook onDone={load} />
      <Input size="sm" mb={2} placeholder="Find a customer…" value={q} onChange={(e) => setQ(e.target.value)} />
      {list === null ? <Spinner size="sm" /> : (
        <Grid templateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap={2}>
          {shown.map((c) => (
            <Button key={c.customerId} variant="outline" height="auto" py={2} px={3} display="block" textAlign="left"
              whiteSpace="normal" onClick={() => setOpen(c.customerId)}>
              <Text fontWeight="bold" fontSize="sm">{c.name}</Text>
              <Text fontSize="xs" color="gray.500" fontWeight="normal">
                {c.lineCount} product{c.lineCount === 1 ? "" : "s"}{c.dueDay ? ` · due ${c.dueDay}` : ""}
              </Text>
            </Button>
          ))}
          {!shown.length && <Text fontSize="sm" color="gray.500">{list.length ? "No customer matches." : "No customers yet. Import the workbook above."}</Text>}
        </Grid>
      )}
    </Box>
  );
};

export default CustomerTemplates;
