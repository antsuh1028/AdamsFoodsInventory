import React, { useCallback, useEffect, useState } from "react";
import { useToast } from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import getRole, { isAdminRole } from "../../utils/getRole";
import FloatingWindow from "../../components/FloatingWindow";
import OrderEditor from "./OrderEditor";
import CustomerTemplates from "./CustomerTemplates";
import { lbText } from "./orderMath";
import "./orderSheets.css";

const STATUS = { draft: "Draft", sent: "Sent", cancelled: "Cancelled" };
const FILTERS = [["open", "Open"], ["draft", "Drafts"], ["sent", "Sent"], ["cancelled", "Cancelled"], ["all", "All"]];

// What an order asks for, from the list's totals: cases, plus pounds-only lines.
const wantOf = (o) => [o.cases ? `${o.cases} cs` : "", Number(o.lbsOnly) ? `${lbText(o.lbsOnly)} lb` : ""]
  .filter(Boolean).join(" + ") || "—";

// The customers, as the workbook's tabs were: pick one to start its order.
const CustomerPanel = ({ customers, current, onPick }) => {
  const [q, setQ] = useState("");
  const t = q.trim().toUpperCase();
  const list = (customers || []).filter((c) => !t || c.name.toUpperCase().includes(t) || (c.displayName || "").toUpperCase().includes(t));
  return (
    <div className="panel">
      <h2>Customer</h2>
      <input className="field" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${customers ? customers.length : ""} customers…`} />
      <div className="custs">
        {customers === null ? <div className="empty" style={{ padding: "8px 10px" }}>Loading…</div>
          : list.map((c) => (
            <button type="button" key={c.customerId} aria-current={c.customerId === current} onClick={() => onPick(c)}>
              <b>{c.name}</b>
              <small>{c.lineCount} product{c.lineCount === 1 ? "" : "s"}{c.shipTo ? ` · ${c.shipTo.slice(0, 32)}` : ""}</small>
            </button>
          ))}
        {customers !== null && !list.length && (
          <div className="empty" style={{ padding: "8px 10px" }}>
            {customers.length ? "No customer matches." : "No customers yet. An admin imports them from the order workbook."}
          </div>
        )}
      </div>
    </div>
  );
};

// The orders made, newest first, under the order being written.
const OrdersPanel = ({ orders, status, setStatus, q, setQ, current, onOpen }) => (
  <div className="panel">
    <h2>Orders</h2>
    <div className="seg">
      {FILTERS.map(([k, label]) => (
        <button type="button" key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{label}</button>
      ))}
    </div>
    <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, order # or PO…" />
    <div className="orders">
      {orders === null ? <div className="empty">Loading…</div> : orders.map((o) => (
        <button type="button" key={o.orderId} aria-current={o.orderId === current} onClick={() => onOpen(o)}>
          <span><b>{o.customerName}</b> #{o.orderNo}<span className={`pill ${o.status}`}>{STATUS[o.status]}</span></span>
          <span className="empty">{o.lineCount} line{o.lineCount === 1 ? "" : "s"} · {wantOf(o)} · due {o.dueDay || "—"}</span>
        </button>
      ))}
      {orders !== null && !orders.length && <div className="empty">No orders here yet.</div>}
    </div>
  </div>
);

/** The office's orders: made from customer templates, printed, sent to the floor. */
const OrderSheets = ({ isOpen, onClose }) => {
  const admin = isAdminRole(getRole());
  const toast = useToast();
  const [full, setFull] = useState(true);
  const [view, setView] = useState("orders");          // orders | customers
  const [open, setOpen] = useState({ key: 0 });         // { key, orderId?, customerId? }
  const [current, setCurrent] = useState({});          // what is on the sheet now, for highlighting
  const [customers, setCustomers] = useState(null);
  const [orders, setOrders] = useState(null);
  const [status, setStatus] = useState("open");
  const [q, setQ] = useState("");

  const fetchCustomers = useCallback(() => {
    axiosInstance.get("/af-customers").then(({ data }) => setCustomers(data.filter((c) => c.active)))
      .catch((err) => { setCustomers([]); toast({ status: "error", title: "Could not load customers", description: err.response?.data?.error || err.message, position: "top" }); });
  }, [toast]);

  const fetchOrders = useCallback(async () => {
    try {
      const params = { ...(status !== "open" && status !== "all" ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) };
      const { data } = await axiosInstance.get("/af-orders", { params });
      setOrders(status === "open" ? data.filter((o) => o.status !== "cancelled") : data);
    } catch (err) {
      setOrders([]);
      toast({ status: "error", title: "Could not load orders", description: err.response?.data?.error || err.message, position: "top" });
    }
  }, [status, q, toast]);

  useEffect(() => { if (isOpen) fetchCustomers(); }, [isOpen, fetchCustomers]);
  // Debounced, so typing a search is one request, not one per key.
  useEffect(() => {
    if (!isOpen) return undefined;
    const t = setTimeout(fetchOrders, 200);
    return () => clearTimeout(t);
  }, [isOpen, fetchOrders]);

  const start = (c) => { setOpen((o) => ({ key: o.key + 1, customerId: c.customerId })); setCurrent({ customerId: c.customerId }); };
  const openOrder = (o) => { setOpen((x) => ({ key: x.key + 1, orderId: o.orderId })); setCurrent({ orderId: o.orderId, customerId: o.customerId }); };
  const clear = () => { setOpen((x) => ({ key: x.key + 1 })); setCurrent({}); fetchOrders(); };
  const close = () => { setView("orders"); onClose(); };

  return (
    <FloatingWindow isOpen={isOpen} onClose={close} title="Order Sheets" width={1400}
      isFullScreen={full} onToggleFullScreen={() => setFull((f) => !f)} bodyProps={{ p: 0, bg: "#f2f4f7" }}>
      <div className="afo">
        <div className="afo-wrap">
          <div className="afo-top">
            <h1>Order Sheets</h1>
            {view === "customers" && (
              <button type="button" className="btn ghost" onClick={() => { setView("orders"); fetchCustomers(); }}>← Back to orders</button>
            )}
            <span className="afo-who">{admin ? "Office / admin · prices shown" : "Office · prices are admin only"}</span>
            {admin && view === "orders" && (
              <button type="button" className="btn outline sm" onClick={() => setView("customers")}>Customers &amp; templates</button>
            )}
          </div>
          {view === "customers" ? (
            <div className="panel"><CustomerTemplates onBack={() => { setView("orders"); fetchCustomers(); }} /></div>
          ) : (
            <div className="afo-layout">
              <CustomerPanel customers={customers} current={current.customerId} onPick={start} />
              <OrderEditor key={open.key} orderId={open.orderId || null} customerId={open.customerId || null}
                onChanged={(o) => { setCurrent({ orderId: o.orderId, customerId: o.customerId }); fetchOrders(); }}
                onClosed={clear}
                rail={<OrdersPanel orders={orders} status={status} setStatus={setStatus} q={q} setQ={setQ}
                  current={current.orderId} onOpen={openOrder} />} />
            </div>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
};

export default OrderSheets;
