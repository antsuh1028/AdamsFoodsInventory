// Box weighing routes, one file per part. Mount order is kept: a literal path
// such as /box-batches/unregistered must come before /box-batches/:id.
const router = require("express").Router();
const { validateItem, toThousandths } = require("./boxes/helpers/validate");

router.use(require("./boxes/sessions/reads"));
router.use(require("./boxes/sessions/lifecycle"));
router.use(require("./boxes/sessions/edits"));
router.use(require("./boxes/sessions/items"));
router.use(require("./boxes/tallyImport"));
router.use(require("./boxes/manifests"));
router.use(require("./boxes/removals"));
router.use(require("./boxes/formLinks"));

module.exports = router;
module.exports.validateItem = validateItem;
module.exports.toThousandths = toThousandths;
