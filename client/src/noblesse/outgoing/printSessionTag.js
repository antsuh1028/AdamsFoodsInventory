import axiosInstance from "../../utils/axiosInstance";
import printOutgoingTag from "./printOutgoingTag";
import { fmtDate, fmtDateOnly } from "../common/shared";

// The pallet tag for a weighed session, from its detail as GET /box-batches/:id returns it.
export const tagFromDetail = (detail, win = null) => printOutgoingTag({
  lotNumber: detail.lot_number,
  date: detail.weighed_on
    ? fmtDate(detail.weighed_on)
    : fmtDateOnly(detail.closed_at || detail.created_at),
  shipTo: detail.ship_to,
  itemDescription: detail.item_description,
  billOfLading: detail.bill_of_lading,
  driver: detail.driver || "",
  boxes: detail.items || [],
  weighedBy: detail.vendor || "",
  memo: detail.remarks || "",
  furtherProcessing: Boolean(detail.further_processing),
  win,
});

/**
 * One click to a printed tag. The window opens on the click itself, before the
 * boxes load, so the browser treats it as the user's and does not block it.
 * `before` runs first (e.g. stopping the session). Throws on failure.
 */
const printSessionTag = async (batchId, before = null) => {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Allow pop-ups to print");
  win.document.write("<p style=\"font-family:sans-serif\">Loading the tag…</p>");
  try {
    if (before) await before();
    const { data } = await axiosInstance.get(`/box-batches/${batchId}`);
    tagFromDetail(data, win);
  } catch (err) {
    win.close();
    throw err;
  }
};

export default printSessionTag;
