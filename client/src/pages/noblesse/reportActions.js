import axiosInstance from "../../utils/axiosInstance";

// Accepting is reachable from two places — the Processing tab and the
// registration form — and the refusals are the part that must not drift. The
// server names exactly what is wrong (no form for the lot, not enough cases,
// already accepted) and that message is the whole value of the 409.
const runAction = async (reportId, path, body, toast) => {
  try {
    const { data } = await axiosInstance.post(
      `/processing-reports/${reportId}/${path}`, body || {}
    );
    return { ok: true, report: data };
  } catch (err) {
    const res = err.response?.data || {};
    toast({
      status: "error", position: "top", duration: 9000, isClosable: true,
      title: TITLES[res.code] || TITLES[path] || "That did not work",
      description: res.error || err.message,
    });
    return { ok: false, code: res.code };
  }
};

const TITLES = {
  NO_FORM_FOR_LOT: "This lot has no registration form yet",
  AMBIGUOUS_FORM: "More than one form for this lot",
  INSUFFICIENT_STOCK: "Not enough cases on the lot",
  ALREADY_ACCEPTED: "Already accepted",
  NO_RAW_STOCK: "No raw stock on this lot",
  accept: "Could not accept",
  reject: "Could not send it back",
  unaccept: "Could not un-accept",
};

export const acceptReport = (id, toast) => runAction(id, "accept", null, toast);
export const rejectReport = (id, reason, toast) =>
  runAction(id, "reject", { reason: reason || null }, toast);
export const unacceptReport = (id, toast) => runAction(id, "unaccept", null, toast);
