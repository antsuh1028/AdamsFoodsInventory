import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../../utils/axiosInstance";
import FloatingWindow from "../../components/FloatingWindow";
import getRole from "../../utils/getRole";
import { createScanAssembler, scanKey } from "../../utils/scanInput";
import { parseGs1 } from "../../utils/gs1";
import { toPounds } from "../../utils/weight";
import logo from "../../assets/AdamsWings.png";
import printPickSheet from "../orders/printPickSheet";
import { wantText, lbText } from "../orders/orderMath";
import "./orderPicking.css";

const errText = (err) => err.response?.data?.error || err.message;
const mils = (w) => Math.round(Number(w || 0) * 1000);

// What a line asks for and how far along it is, in the sheet's own words.
const progress = (l) => {
  const lbsPart = l.lbs != null ? `${lbText(l.totalLb)}/${lbText(l.lbs)} lb` : "";
  if (l.qtyCases != null) return `${l.count}/${l.qtyCases}${lbsPart ? ` · ${lbsPart}` : ""}`;
  return lbsPart;
};
const progClass = (l) => (l.full ? "ok" : l.count ? "part" : "none");
const lineCells = (l, count) => {
  const want = l.qtyCases || (l.lbs ? Math.max(count + 1, 1) : 1);
  return Math.max(10, Math.ceil(Math.max(want, count) / 10) * 10);
};

// The label's own weight in pounds, shown until the server confirms the box; null for a pallet tag.
const labelWeight = (raw) => {
  try {
    const p = parseGs1(raw);
    return p && p.weight ? toPounds(p.weight.value, p.weight.unit).weight : null;
  } catch {
    return null;
  }
};

// The scanner types like a keyboard; keys typed into a field are left alone.
const useScanner = (enabled, onScan) => {
  const assembler = useMemo(() => createScanAssembler({ parse: (raw) => raw }), []);
  const handler = useRef(onScan);
  handler.current = onScan;
  useEffect(() => {
    if (!enabled) return undefined;
    assembler.reset();
    const onKeyDown = (e) => {
      const key = scanKey(e);
      if (key === null) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "Enter" || e.key === "Tab" || key !== e.key) e.preventDefault();
      const result = assembler.handleKey({ key, timeStamp: e.timeStamp });
      if (result) handler.current(result);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, assembler]);
};

/** The floor fills sent orders by scanning boxes into their lines. */
const PickingBoard = ({ inWindow = false, scanning = true }) => {
  const navigate = useNavigate();
  const role = getRole();
  const [view, setView] = useState("open");          // open | filled
  const [orders, setOrders] = useState(null);
  const [active, setActive] = useState(null);        // { orderId, lineId }
  const [msg, setMsg] = useState(null);              // { kind, text, sub }
  const [pallet, setPallet] = useState(null);        // { lineId, code, boxes, room, chosen: Set }
  const [checker, setChecker] = useState({});        // orderId -> name
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState([]);       // scanned, not yet confirmed: { key, lineId, weight }
  const queue = useRef(Promise.resolve());           // scans go to the server one at a time, in order
  const seq = useRef(0);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  const load = useCallback(async () => {
    try {
      const { data } = await axiosInstance.get("/af-picking/orders", { params: view === "filled" ? { status: "filled" } : {} });
      setOrders(data);
    } catch (err) {
      setOrders([]);
      setMsg({ kind: "bad", text: "Could not load the orders.", sub: errText(err) });
    }
  }, [view]);

  useEffect(() => { setOrders(null); load(); }, [load]);
  // The office sends orders while the floor works; refresh every half minute.
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const replace = (order) => setOrders((os) => (os || []).map((o) => (o.orderId === order.orderId ? order : o)));
  // A line from the server swapped into its order; returns that order.
  const mergeLine = (line) => {
    let merged = null;
    const next = (ordersRef.current || []).map((o) => {
      if (!o.lines.some((l) => l.lineId === line.lineId)) return o;
      merged = { ...o, lines: o.lines.map((l) => (l.lineId === line.lineId ? line : l)) };
      return merged;
    });
    ordersRef.current = next;
    setOrders(next);
    return merged;
  };
  const findLine = (lineId) => {
    for (const o of ordersRef.current || []) {
      const l = o.lines.find((x) => x.lineId === lineId);
      if (l) return { order: o, line: l, index: o.lines.indexOf(l) };
    }
    return null;
  };
  const where = (order, index) => `${order.customerName}, line ${index + 1}`;

  // After a box lands: the line's count, and on to the next open line of the order once it is full.
  const afterPick = (order, lineId, weight) => {
    replace(order);
    const index = order.lines.findIndex((l) => l.lineId === lineId);
    const line = order.lines[index];
    const sub = `${progress(line)}${line.short ? ` · ${line.short}` : ""}`;
    if (line.full) {
      const next = order.lines.find((l) => !l.full);
      setActive(next ? { orderId: order.orderId, lineId: next.lineId } : null);
      setMsg({ kind: "ok", text: `${weight ? `${lbText(weight)} lb onto ` : ""}${where(order, index)}. Line full.`,
        sub: next ? `Now scanning into line ${order.lines.indexOf(next) + 1}.` : "Every line is full: check it and finish the order." });
    } else {
      setMsg({ kind: line.short ? "warn" : "ok", text: `${weight ? `${lbText(weight)} lb onto ` : ""}${where(order, index)}.`, sub });
    }
  };

  const sendScan = async (lineId, raw, key) => {
    try {
      const { data } = await axiosInstance.post(`/af-picking/lines/${lineId}/scan`, { barcode: raw });
      if (data.pallet) {
        const p = data.pallet;
        const f = findLine(lineId);
        // Preselect what the line can take: its free cases, or enough boxes to reach its pounds.
        let chosen = p.boxes.map((b) => b.boxId);
        if (p.room != null) chosen = chosen.slice(0, p.room);
        else if (f && f.line.lbs != null) {
          let have = mils(f.line.totalLb); const want = mils(f.line.lbs); chosen = [];
          for (const b of p.boxes) { if (have >= want) break; chosen.push(b.boxId); have += mils(b.weight); }
        }
        setPallet({ lineId, ...p, chosen: new Set(chosen) });
        setMsg(null);
      } else {
        const order = mergeLine(data.line);
        if (order) afterPick(order, lineId, data.picked.weight);
      }
    } catch (err) {
      setMsg({ kind: "bad", text: errText(err) });
    } finally {
      setPending((ps) => ps.filter((x) => x.key !== key));
    }
  };

  // The box shows in its line at once; the server confirms it or takes it back off with the reason.
  const onScan = (result) => {
    if (view !== "open") return;
    if (result.type === "reject") { setMsg({ kind: "bad", text: "That scan did not read.", sub: result.reason }); return; }
    if (!active) { setMsg({ kind: "warn", text: "Tap a line first, then scan its boxes." }); return; }
    const { lineId } = active;
    const key = ++seq.current;
    const weight = labelWeight(result.raw);
    if (weight) setPending((ps) => [...ps, { key, lineId, weight }]);
    queue.current = queue.current.then(() => sendScan(lineId, result.raw, key));
  };
  useScanner(scanning, onScan);

  const takePallet = async () => {
    setBusy(true);
    try {
      const { data } = await axiosInstance.post(`/af-picking/lines/${pallet.lineId}/boxes`, { boxIds: [...pallet.chosen] });
      const n = pallet.chosen.size;
      setPallet(null);
      const order = mergeLine(data.line);
      if (order) afterPick(order, pallet.lineId, null);
      setMsg((m) => ({ ...m, text: `${n} box${n === 1 ? "" : "es"} from ${pallet.code}: ${m.text}` }));
    } catch (err) {
      setMsg({ kind: "bad", text: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  const unpick = async (order, line, pick) => {
    try {
      const { data } = await axiosInstance.delete(`/af-picking/picks/${pick.pickId}`);
      replace(data.order);
      setActive({ orderId: order.orderId, lineId: line.lineId });
      setMsg({ kind: "warn", text: `${lbText(pick.weight)} lb taken off ${order.customerName}. It is back in stock.` });
    } catch (err) {
      setMsg({ kind: "bad", text: errText(err) });
    }
  };

  const finish = async (order) => {
    setBusy(true);
    try {
      const { data } = await axiosInstance.post(`/af-picking/orders/${order.orderId}/finish`, { checkedBy: checker[order.orderId] || "" });
      setOrders((os) => os.filter((o) => o.orderId !== order.orderId));
      if (active && active.orderId === order.orderId) setActive(null);
      setMsg({ kind: "ok", text: `Order #${data.order.orderNo} finished.`, sub: "Its boxes are out of stock. Print it from Finished." });
    } catch (err) {
      setMsg({ kind: "bad", text: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  const print = (order) => printPickSheet({ ...order, lines: order.lines });
  const logout = () => { localStorage.removeItem("token"); localStorage.removeItem("refreshToken"); navigate("/"); };
  const act = active && findLine(active.lineId);

  return (
    <div className={`afp${inWindow ? " in-window" : ""}`}>
      <div className="wrap">
        <div className="top">
          {!inWindow && <h1>Order Picking</h1>}
          <div className="seg">
            <button type="button" aria-pressed={view === "open"} onClick={() => { setView("open"); setPallet(null); }}>Open</button>
            <button type="button" aria-pressed={view === "filled"} onClick={() => { setView("filled"); setActive(null); setPallet(null); }}>Finished</button>
          </div>
          <span className="who">{role}</span>
          {!inWindow && (role === "floor"
            ? <button type="button" className="btn ghost" onClick={logout}>Log out</button>
            : <button type="button" className="btn ghost" onClick={() => navigate("/home")}>← Home</button>)}
        </div>

        <div className="steps">
          <div><b>1 · Tap a line</b>The line you are filling turns blue.</div>
          <div><b>2 · Scan boxes</b>Each box fills the next cell of that line&apos;s tally.</div>
          <div><b>3 · Or a pallet tag</b>Takes the pallet&apos;s boxes; tap any to leave behind.</div>
          <div><b>4 · Finish</b>Only when every line is full and someone has checked it.</div>
        </div>

        <div className="layout">
          <div className="orders">
            {orders === null && <div className="empty">Loading…</div>}
            {orders && !orders.length && (
              <div className="panel"><div className="empty">
                {view === "open" ? "No orders sent to the floor yet." : "No finished orders yet."}
              </div></div>
            )}
            {(orders || []).map((o) => {
              const notFull = o.lines.filter((l) => !l.full);
              const cases = o.lines.reduce((a, l) => a + l.count, 0);
              const lb = o.lines.reduce((a, l) => a + mils(l.totalLb), 0) / 1000;
              const done = o.status === "filled";
              const blockers = [
                ...notFull.map((l) => `Line ${o.lines.indexOf(l) + 1} (${l.code}): ${l.short || progress(l)}`),
                ...(!(checker[o.orderId] || "").trim() ? ["Checked by is not filled in"] : []),
              ];
              return (
                <div className={`sheet${done ? " done" : ""}`} key={o.orderId}>
                  <div className="sh-head">
                    <div className="acct"><span>Order# {o.orderNo}</span><img src={logo} alt="Adams Foods" /><span>{o.po ? `PO# ${o.po}` : ""}</span></div>
                    <span className="k">Customer</span><span className="cust">{o.customerName}</span>
                    <span className="k">Date</span><span>{o.orderDate}</span>
                    <span className="k">Ship/BL To</span><span>{o.shipTo || "—"}</span>
                    <span className="k">Due</span><b>{o.dueDay || "—"}</b>
                  </div>
                  {o.notes && <div className="note">{o.notes}</div>}
                  {o.lines.map((l, i) => {
                    const isActive = active && active.lineId === l.lineId;
                    const waiting = pending.filter((x) => x.lineId === l.lineId);
                    const cells = lineCells(l, l.count + waiting.length);
                    return (
                      <div key={l.lineId} className={`line${l.full ? " full" : ""}${isActive ? " active" : ""}`}
                        onClick={() => { if (!done) { setActive({ orderId: o.orderId, lineId: l.lineId }); setPallet(null); setMsg(null); } }}>
                        <div className="l-top">
                          <span className="qty">{l.qtyCases || ""}{l.lbs != null && <small>{lbText(l.lbs)}#</small>}</span>
                          <span className="desc">
                            <span className="code">{l.code}</span> {l.tag ? `${l.tag} ` : ""}{l.description}
                            {l.note && <span className="lnote">{l.note}</span>}
                          </span>
                          {isActive && <span className="tag-active">SCANNING</span>}
                          <span className={`prog ${progClass(l)}`}>{progress(l)}</span>
                        </div>
                        <div className="tally">
                          {Array.from({ length: cells }, (_, c) => {
                            const p = l.picks[c];
                            const w = !p && waiting[c - l.picks.length];
                            if (w) return <span key={c} className="pending" title="Checking with the server">{lbText(w.weight)}</span>;
                            if (!p) return <span key={c} className={c < (l.qtyCases || 0) ? "need" : ""} />;
                            return done
                              ? <span key={c}>{lbText(p.weight)}</span>
                              : (
                                <button type="button" key={c} title={`Lot ${p.lotNumber}, pallet ${p.palletNo}. Click to take it off.`}
                                  onClick={(e) => { e.stopPropagation(); unpick(o, l, p); }}>{lbText(p.weight)}</button>
                              );
                          })}
                        </div>
                        <div className="l-meta">
                          <span>{lbText(l.totalLb)} lb</span>
                          {l.extraBox && <span className="warn">One box could come off and still make {lbText(l.lbs)} lb.</span>}
                          {l.short && <span className="bad">{l.short}</span>}
                        </div>
                      </div>
                    );
                  })}
                  <div className="sh-foot">
                    <div className="tot">
                      <span>Order Qty <b>{wantText(o.lines)}</b></span>
                      <span>Scanned <b>{cases}</b> cs</span>
                      <span><b>{lbText(lb)}</b> lb</span>
                    </div>
                    {done ? (
                      <>
                        <div className="empty">Finished{o.checkedBy ? `, checked by ${o.checkedBy}` : ""}.</div>
                        <div className="actions"><button type="button" className="btn outline" onClick={() => print(o)}>Print</button></div>
                      </>
                    ) : (
                      <>
                        <label>Checked by
                          <input className="field" value={checker[o.orderId] || ""} placeholder="Name of who checked it"
                            onChange={(e) => setChecker({ ...checker, [o.orderId]: e.target.value.toUpperCase() })} />
                        </label>
                        {blockers.length > 0 && <ul className="blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
                        <div className="actions">
                          <button type="button" className="btn outline" onClick={() => print(o)}>Print</button>
                          <button type="button" className="btn green" disabled={blockers.length > 0 || busy || pending.length > 0}
                            onClick={() => finish(o)}>
                            Finish order · take boxes out
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rail">
            <div className="panel">
              <h2>Scanning into</h2>
              {act ? (
                <div className="active-box">
                  <span className="whom">{act.order.customerName}</span>
                  <span>Line {act.index + 1}: <b>{act.line.code}</b> {act.line.description}</span>
                  <span>{progress(act.line)}</span>
                </div>
              ) : (
                <div className="active-box none">{view === "open" ? "Tap a line on an order to start." : "Finished orders take no boxes."}</div>
              )}
              {pallet && (() => {
                const n = pallet.chosen.size;
                const fits = pallet.room == null || n <= pallet.room;
                return (
                  <div className={`leave${fits ? " fits" : ""}`}>
                    <b>Pallet {pallet.code}: {pallet.boxes.length} free box{pallet.boxes.length === 1 ? "" : "es"}</b>
                    {/* Labels rarely carry an item code, so the product is named for the picker to check. */}
                    <span>Lot {pallet.lotNumber}: {[...new Set(pallet.boxes.map((b) => b.item).filter(Boolean))].join(", ") || "item not recorded"}</span>
                    <small>
                      {pallet.room != null ? `This line has room for ${pallet.room}. ` : ""}
                      Tap a box to leave it behind or take it.{pallet.heldElsewhere ? ` ${pallet.heldElsewhere} are already on other orders.` : ""}
                    </small>
                    <div className="chips">
                      {pallet.boxes.map((b) => (
                        <button type="button" key={b.boxId} className={`chip ${pallet.chosen.has(b.boxId) ? "on" : "off"}`}
                          onClick={() => {
                            const next = new Set(pallet.chosen);
                            if (next.has(b.boxId)) next.delete(b.boxId); else next.add(b.boxId);
                            setPallet({ ...pallet, chosen: next });
                          }}>{lbText(b.weight)}</button>
                      ))}
                    </div>
                    <div className="actions">
                      <button type="button" className="btn sm" disabled={!n || !fits || busy} onClick={takePallet}>
                        Take {n} box{n === 1 ? "" : "es"}
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => setPallet(null)}>Cancel</button>
                    </div>
                  </div>
                );
              })()}
              {msg && (
                <div className={`msg ${msg.kind}`}>
                  <span>{msg.text}</span>
                  {msg.sub && <small>{msg.sub}</small>}
                </div>
              )}
            </div>
            <div className="panel">
              <h2>How it works</h2>
              <div className="empty">
                Scan the box label, or the pallet tag to take several at once. A line asks for cases, pounds, or both:
                both means exactly that many cases, weighing at least that many pounds. Click a weight in a tally to take
                that box back off; it goes straight back to stock. Boxes leave stock only when the order is finished.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// The floor's login lands here as a page.
const OrderPicking = () => <PickingBoard />;

// Everyone else opens it from the menu; it takes scans only while it is the top window.
export const OrderPickingWindow = ({ isOpen, onClose }) => {
  const [full, setFull] = useState(false);
  const [onTop, setOnTop] = useState(true);
  return (
    <FloatingWindow isOpen={isOpen} onClose={onClose} title="Order Picking" width={1400} onTopChange={setOnTop}
      isFullScreen={full} onToggleFullScreen={() => setFull((f) => !f)} bodyProps={{ p: 0, bg: "#f2f4f7" }}>
      <PickingBoard inWindow scanning={onTop} />
    </FloatingWindow>
  );
};

export default OrderPicking;
