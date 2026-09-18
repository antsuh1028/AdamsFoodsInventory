// Who owns a load once the boxes are weighed.
//
// The split on Outgoing is two-party, like the processing report: the DOCK
// weighs finished boxes and does nothing else, and RECEPTION ties those
// sessions to a load, ships it, and decides when a lot is finished.
//
// Listed rather than a single "reception" role because the people doing the job
// today are already on these roles — gating on a new one would lock them out on
// the day it shipped. A dock account is a plain "user", which is excluded here
// and is exactly the point: weighing stays open to everyone, the load does not.
const RECEPTION_ROLES = ["admin", "manager", "noblesse", "reception"];

module.exports = { RECEPTION_ROLES };
