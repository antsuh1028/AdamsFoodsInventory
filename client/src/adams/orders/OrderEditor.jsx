import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Text, Button, Spinner, Flex, useToast,
  AlertDialog, AlertDialogBody, AlertDialogFooter, AlertDialogHeader, AlertDialogContent, AlertDialogOverlay,
} from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import getRole, { isAdminRole } from "../../utils/getRole";
import logo from "../../assets/AdamsWings.png";
import printPickSheet from "./printPickSheet";
import { DAYS, caseLb, isOrdered, casesOf, lbsOf, lineLb, wantText, money, lbText } from "./orderMath";

const pacificToday = () => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const lineKey = (code, description) => `${String(code).trim()}|${String(description).trim().toUpperCase()}`;
const errText = (err) => err.response?.data?.error || err.message;

// A template line as an editable row, with what this order already asks of it.
const toRow = (t, saved) => ({
  key: lineKey(t.code, t.description), code: t.code, tag: t.tag || "", description: t.description,
  qtyCases: saved?.qtyCases != null ? String(saved.qtyCases) : "",
  lbs: saved?.lbs != null ? lbText(saved.lbs) : "",
  note: saved?.note || "", noteOpen: false,
  price: saved && "price" in saved ? (saved.price ?? "") : (t.price ?? ""),
  fromTemplate: t.fromTemplate !== false,
});

const STATUS = { draft: "Draft", sent: "Sent to the floor", cancelled: "Cancelled" };

/**
 * One order, drawn like the paper sheet, with its summary in the rail. A new order
 * starts from `customerId`'s template; an existing one opens by `orderId`.
 * Renders two grid cells: the sheet, and the rail with `rail` under the summary.
 */
const OrderEditor = ({ orderId = null, customerId = null, rail = null, onChanged, onClosed }) => {
  const admin = isAdminRole(getRole());
  const toast = useToast();
  const [head, setHead] = useState(null);
  const [template, setTemplate] = useState(null);   // { name, from, count }
  const [rows, setRows] = useState([]);
  const [onlyOrdered, setOnlyOrdered] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);  // "delete" | "cancel"
  const safeRef = useRef(null);

  // An existing order: its template, with this order's lines laid over it.
  const load = useCallback(async (id) => {
    const { data: o } = await axiosInstance.get(`/af-orders/${id}`);
    let tpl = null;
    if (o.customerId) {
      try { tpl = (await axiosInstance.get(`/af-customers/${o.customerId}`)).data; } catch { tpl = null; }
    }
    const tplLines = tpl ? tpl.lines : [];
    const saved = new Map(o.lines.map((l) => [lineKey(l.code, l.description), l]));
    const fromTpl = tplLines.map((t) => toRow(t, saved.get(lineKey(t.code, t.description))));
    const onTpl = new Set(fromTpl.map((r) => r.key));
    const extras = o.lines.filter((l) => !onTpl.has(lineKey(l.code, l.description)))
      .map((l) => toRow({ ...l, fromTemplate: false }, l));
    setHead(o);
    setTemplate(tpl ? { name: tpl.name, from: tpl.templateFrom, count: tplLines.length } : null);
    setRows([...fromTpl, ...extras]);
    setOnlyOrdered(o.status !== "draft");
    return o;
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (orderId) {
          await load(orderId);
        } else if (customerId) {
          const { data } = await axiosInstance.get(`/af-customers/${customerId}`);
          if (!live) return;
          setHead({ orderId: null, orderNo: null, status: "draft", customerId, customerName: data.displayName,
            shipTo: data.shipTo || "", dueDay: data.dueDay || "", orderDate: pacificToday(), po: "", notes: "" });
          setTemplate({ name: data.name, from: data.templateFrom, count: data.lines.length });
          setRows(data.lines.map((t) => toRow(t, null)));
        }
      } catch (err) {
        toast({ status: "error", title: "Could not open that order", description: errText(err), position: "top" });
      }
    })();
    return () => { live = false; };
  }, [orderId, customerId, load, toast]);

  // Item search for a product that is not on the template.
  useEffect(() => {
    const q = addSearch.trim();
    if (!adding || q.length < 2) { setHits([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      axiosInstance.get("/af-items", { params: { q, limit: 30 } }).then(({ data }) => { if (live) setHits(data); }).catch(() => {});
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [addSearch, adding]);

  const ordered = useMemo(() => rows.filter(isOrdered), [rows]);

  // ── Nothing open ───────────────────────────────────────────────────────────
  if (!head) {
    return (
      <>
        <div className="panel">
          {orderId || customerId ? <Flex justify="center" py={8}><Spinner /></Flex> : (
            <>
              <h2>Pick a customer to start an order</h2>
              <div className="empty">
                Each customer&apos;s products come from their template. Type cases, pounds, or both for what they want
                this time; lines left blank are not on the order. Or open an order from the list on the right.
              </div>
            </>
          )}
        </div>
        <div className="afo-rail">{rail}</div>
      </>
    );
  }

  const locked = head.status === "cancelled";
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setH = (k, v) => setHead((h) => ({ ...h, [k]: v }));
  const addItem = (it) => {
    const k = lineKey(it.code, it.description);
    if (rows.some((r) => r.key === k)) {
      toast({ status: "info", title: `${it.code} is already on this order`, position: "top", duration: 2500 });
    } else {
      setRows((rs) => [...rs, toRow({ ...it, fromTemplate: false, price: "" }, null)]);
    }
    setAdding(false); setAddSearch(""); setOnlyOrdered(false);
  };

  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !onlyOrdered || isOrdered(r));
  const problems = [];
  if (!ordered.length) problems.push("No line has cases or pounds yet.");
  if (!head.dueDay) problems.push("Pick a due day.");
  const unpriced = admin ? ordered.filter((r) => !r.price).length : 0;
  const estLb = ordered.reduce((a, r) => a + lineLb(r), 0);
  const value = ordered.reduce((a, r) => a + lineLb(r) * (Number(r.price) || 0), 0);

  const payload = () => ({
    customerId: head.customerId, orderDate: head.orderDate, shipTo: head.shipTo, dueDay: head.dueDay || null,
    po: head.po, notes: head.notes,
    lines: rows.map((r) => ({
      code: r.code, tag: r.tag || null, description: r.description, qtyCases: r.qtyCases, lbs: r.lbs,
      note: r.note, fromTemplate: r.fromTemplate, ...(admin ? { price: r.price } : {}),
    })),
  });
  const save = async () => {
    const { data } = head.orderId
      ? await axiosInstance.put(`/af-orders/${head.orderId}`, payload())
      : await axiosInstance.post("/af-orders", payload());
    return load(data.orderId);
  };
  const run = async (what, fn, success) => {
    setBusy(what);
    try {
      const out = await fn();
      if (out && onChanged) onChanged(out);
      if (success) toast({ status: "success", position: "top", duration: 3000, title: success(out) });
    } catch (err) {
      toast({ status: "error", position: "top", duration: 7000, isClosable: true, title: "That did not go through", description: errText(err) });
    } finally {
      setBusy(false);
    }
  };
  const onSave = () => run("save", save, (o) => `Order #${o.orderNo} saved`);
  const onSend = () => run("send", async () => {
    const o = await save();
    await axiosInstance.post(`/af-orders/${o.orderId}/send`);
    return load(o.orderId);
  }, (o) => `Order #${o.orderNo} sent to the floor`);
  const onPrint = () => {
    // Opened on the click so a popup blocker allows it; filled once saved.
    const win = window.open("", "_blank");
    run("print", async () => {
      const o = locked ? head : await save();
      if (!printPickSheet({ ...o, lines: rows }, win)) throw new Error("The print window was blocked.");
      return locked ? null : o;
    });
  };
  const onConfirm = () => run(confirm, async () => {
    if (confirm === "delete") {
      await axiosInstance.delete(`/af-orders/${head.orderId}`);
      setConfirm(null);
      if (onClosed) onClosed();
      return null;
    }
    await axiosInstance.post(`/af-orders/${head.orderId}/cancel`);
    setConfirm(null);
    return load(head.orderId);
  }, () => (confirm === "delete" ? "Draft deleted" : "Order cancelled"));

  return (
    <>
      <div className="sheet">
        <div className="sh-top">
          <span className="sh-no">{head.orderNo ? <>Order# <b>{head.orderNo}</b></> : <>Order# <span className="empty">given on save</span></>}</span>
          <img src={logo} alt="Adams Foods" />
          <span className="from">
            {template ? `Template: ${template.name}${template.from ? `, as of ${template.from}` : ""}` : ""}
          </span>
        </div>
        <div className="sh-head">
          <span className="k">Customer</span><span className="cust">{head.customerName}</span>
          <span className="k">Date</span>
          <input className="field" type="date" value={head.orderDate || ""} disabled={locked} onChange={(e) => setH("orderDate", e.target.value)} />
          <span className="k">Ship/BL To</span>
          <input className="field" value={head.shipTo || ""} disabled={locked} placeholder="WILL CALL @ AFDC, DELIVER…"
            onChange={(e) => setH("shipTo", e.target.value.toUpperCase())} />
          <span className="k">Due</span>
          <select className="field" value={head.dueDay || ""} disabled={locked} onChange={(e) => setH("dueDay", e.target.value)}>
            <option value="">Pick a day…</option>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="k">PO#</span>
          <input className="field" value={head.po || ""} disabled={locked} onChange={(e) => setH("po", e.target.value.toUpperCase())} />
          <span className="k">Status</span>
          <span><span className={`pill ${head.status}`} style={{ marginLeft: 0 }}>{STATUS[head.status]}</span></span>
          <span className="k">Order note</span>
          <input className="field" style={{ gridColumn: "2 / -1" }} value={head.notes || ""} disabled={locked}
            placeholder="Prints under the lines, e.g. delivery window" onChange={(e) => setH("notes", e.target.value.toUpperCase())} />
        </div>

        <div className="tools">
          <label><input type="checkbox" checked={onlyOrdered} onChange={(e) => setOnlyOrdered(e.target.checked)} /> Only ordered lines</label>
          <span className="empty" style={{ marginLeft: "auto" }}>
            {template ? `${template.count} product${template.count === 1 ? "" : "s"} on ${template.name}'s template` : ""}
          </span>
        </div>

        <div className="lines">
          <table>
            <thead>
              <tr>
                <th>Cases</th><th>Lbs</th><th>Item</th><th style={{ textAlign: "right" }}>Size</th>
                {admin && <th style={{ textAlign: "right" }}>$/lb</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map(({ r, i }) => {
                const cw = caseLb(r.description);
                const n = casesOf(r); const w = lbsOf(r);
                return (
                  <tr key={r.key} className={isOrdered(r) ? "on" : ""}>
                    <td>
                      <input className="field qty" inputMode="numeric" value={r.qtyCases} placeholder="0" disabled={locked}
                        aria-label={`Cases of ${r.code}`} onChange={(e) => setRow(i, { qtyCases: e.target.value.replace(/[^\d]/g, "") })} />
                    </td>
                    <td>
                      <input className="field qty lbs" inputMode="decimal" value={r.lbs} placeholder="—" disabled={locked}
                        aria-label={`Pounds of ${r.code}`} onChange={(e) => setRow(i, { lbs: e.target.value.replace(/[^\d.]/g, "") })} />
                    </td>
                    <td>
                      <span className="code">{r.code}</span>{r.tag ? <span className="tag">{r.tag}</span> : " "}
                      <span className="desc">{r.description}</span>
                      {!r.fromTemplate && <span className="added">added</span>}
                      {r.note && !r.noteOpen && <div className="noteline">{r.note}</div>}
                      {r.noteOpen && (
                        <div className="note">
                          <input className="field" value={r.note} placeholder="Note that prints under this line" autoFocus
                            onChange={(e) => setRow(i, { note: e.target.value.toUpperCase() })}
                            onKeyDown={(e) => { if (e.key === "Enter") setRow(i, { noteOpen: false }); }} />
                        </div>
                      )}
                      {!locked && (
                        <div>
                          <button type="button" className="btn ghost sm" onClick={() => setRow(i, { noteOpen: !r.noteOpen })}>
                            {r.noteOpen ? "Done" : r.note ? "Edit note" : "+ note"}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {cw ? `${cw} lb/cs` : ""}
                      {n && !w && cw ? <><br />≈ {(n * cw).toLocaleString()} lb</> : null}
                      {w && !n && cw ? <><br />≈ {Math.ceil(w / cw)} cs</> : null}
                      {w && n ? <><br />at least {w.toLocaleString()} lb</> : null}
                    </td>
                    {admin && (
                      <td>
                        <input className="field price" inputMode="decimal" value={r.price ?? ""} placeholder="—" disabled={locked}
                          aria-label={`Price of ${r.code}`} onChange={(e) => setRow(i, { price: e.target.value.replace(/[^\d.]/g, "") })} />
                      </td>
                    )}
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={admin ? 5 : 4} className="empty">No ordered lines yet.</td></tr>}
            </tbody>
          </table>
        </div>

        {!locked && (
          <div className="addrow">
            {adding ? (
              <>
                <div className="label">Add a product not on this template</div>
                <input className="field" autoFocus value={addSearch} onChange={(e) => setAddSearch(e.target.value)}
                  placeholder="Search item codes, e.g. tongue or 109710" autoComplete="off" />
                {hits.length > 0 && (
                  <div className="found">
                    {hits.map((it) => (
                      <button type="button" key={it.itemId} onClick={() => addItem(it)}>
                        <b style={{ fontFamily: "var(--mono)" }}>{it.code}</b> {it.description}
                      </button>
                    ))}
                  </div>
                )}
                {addSearch.trim().length >= 2 && !hits.length && <div className="empty">No item code matches.</div>}
                <div><button type="button" className="btn ghost sm" onClick={() => { setAdding(false); setAddSearch(""); }}>Close</button></div>
              </>
            ) : (
              <div><button type="button" className="btn outline sm" onClick={() => setAdding(true)}>+ Add a product not on the template</button></div>
            )}
          </div>
        )}

        <div className="sh-foot">
          <div className="sh-actions">
            <button type="button" className="btn outline" onClick={onPrint} disabled={!ordered.length || Boolean(busy)}>
              {busy === "print" ? "Printing…" : "Print pick sheet"}
            </button>
            {!locked && (
              <button type="button" className="btn ghost" onClick={onSave} disabled={Boolean(busy)}>
                {busy === "save" ? "Saving…" : head.status === "sent" ? "Save changes" : "Save as draft"}
              </button>
            )}
            {head.status === "draft" && head.orderId && (
              <button type="button" className="btn red" onClick={() => setConfirm("delete")} disabled={Boolean(busy)}>Delete draft</button>
            )}
            {head.status === "sent" && admin && (
              <button type="button" className="btn red" onClick={() => setConfirm("cancel")} disabled={Boolean(busy)}>Cancel order</button>
            )}
            {head.status === "draft" && (
              <button type="button" className="btn green" style={{ marginLeft: "auto" }} onClick={onSend}
                disabled={problems.length > 0 || Boolean(busy)}>
                {busy === "send" ? "Sending…" : "Send to the floor"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="afo-rail">
        <div className="panel">
          <h2>This order</h2>
          <div className="sum">
            <span>{head.customerName}</span><span>{head.orderNo ? `#${head.orderNo}` : ""}</span>
            <span>Lines ordered</span><b>{ordered.length}</b>
            <span>Ordered</span><b>{wantText(ordered)}</b>
            <span>Weight (estimate)</span><b>≈ {Math.round(estLb).toLocaleString()} lb</b>
            {admin && <><span>Value (estimate)</span><b>{money(value)}</b></>}
          </div>
          <div className="empty">
            Estimates: pounds where a line asks for them, otherwise cases times the size in the description.
            The real figures come from the scanned boxes. A line with both is exactly that many cases,
            weighing at least that many pounds.
          </div>
          {!locked && problems.map((p) => <div key={p} className="err">{p}</div>)}
          {!locked && unpriced > 0 && (
            <div className="warn">{unpriced} ordered line{unpriced === 1 ? " has" : "s have"} no price.</div>
          )}
        </div>
        {rail}
      </div>

      <AlertDialog isOpen={Boolean(confirm)} leastDestructiveRef={safeRef} onClose={() => setConfirm(null)} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {confirm === "delete" ? `Delete draft #${head.orderNo}?` : `Cancel order #${head.orderNo}?`}
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text fontSize="sm">
                {confirm === "delete"
                  ? "It was never sent to the floor, so nothing else changes."
                  : "It stays on record as cancelled and can no longer be changed. Tell the floor if they have the sheet."}
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={safeRef} onClick={() => setConfirm(null)}>Go back</Button>
              <Button colorScheme="red" isLoading={busy === confirm} onClick={onConfirm}>
                {confirm === "delete" ? "Delete draft" : "Cancel order"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
};

export default OrderEditor;
