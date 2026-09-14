import axiosInstance from "../../utils/axiosInstance";

// Accepting is reachable from two places — the Processing tab and the
// registration form — so what each step SAYS lives here rather than at either
// call site. The refusals matter most: the server names exactly what is wrong
// (no form for the lot, not enough cases, already accepted) and that message is
// the whole value of the 409.

const FAIL_TITLES = {
  NO_FORM_FOR_LOT: "This lot has no registration form yet",
  AMBIGUOUS_FORM: "More than one form for this lot",
  INSUFFICIENT_STOCK: "Not enough cases on the lot",
  ALREADY_ACCEPTED: "Already accepted",
  NOT_ACCEPTED: "That report was not accepted",
  NO_RAW_STOCK: "No raw stock on this lot",
  accept: "Could not accept",
  reject: "Could not send it back",
  unaccept: "Could not un-accept",
};

const cases = (n) => `${n} case${n === 1 ? "" : "s"}`;

// Accept and un-accept move stock, so they say what moved and what is left —
// the figure someone would otherwise go and look up.
const OK = {
  accept: (d) => ({
    title: `${cases(d.casesTaken)} off ${d.lotNumber}`,
    description: d.casesLeft === 0
      ? "That is the whole lot. A run was added to the registration form."
      : `${cases(d.casesLeft)} left on the lot. A run was added to the registration form.`,
  }),
  unaccept: (d) => ({
    title: `${cases(d.casesReturned)} back on ${d.lotNumber}`,
    description: d.casesLeft != null
      ? `${cases(d.casesLeft)} on the lot now. The run was taken off the form.`
      : "The run was taken off the form.",
  }),
  reject: () => ({
    title: "Sent back to the floor",
    description: "Nothing moved. It can be corrected and submitted again.",
  }),
};

const runAction = async (reportId, path, body, toast) => {
  try {
    const { data } = await axiosInstance.post(
      `/processing-reports/${reportId}/${path}`, body || {}
    );
    const said = OK[path] ? OK[path](data) : null;
    if (said) {
      toast({
        status: "success", position: "top", duration: 6000, isClosable: true,
        ...said,
      });
    }
    return { ok: true, report: data };
  } catch (err) {
    const res = err.response?.data || {};
    toast({
      status: "error", position: "top", duration: 9000, isClosable: true,
      title: FAIL_TITLES[res.code] || FAIL_TITLES[path] || "That did not work",
      description: res.error || err.message,
    });
    return { ok: false, code: res.code };
  }
};

export const acceptReport = (id, toast) => runAction(id, "accept", null, toast);
export const rejectReport = (id, reason, toast) =>
  runAction(id, "reject", { reason: reason || null }, toast);
export const unacceptReport = (id, toast) => runAction(id, "unaccept", null, toast);
