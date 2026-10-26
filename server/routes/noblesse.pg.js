// Noblesse routes, one file per part. Each part keeps its literal paths
// (such as /all/history) ahead of its :id routes. Schema lives in db/migrate.js;
// nothing here fires DDL at load.
const router = require("express").Router();

router.use(require("./noblesse/receipts"));
router.use(require("./noblesse/ntiInventory"));
router.use(require("./noblesse/procOrders"));
router.use(require("./noblesse/registrationForms"));

module.exports = router;
