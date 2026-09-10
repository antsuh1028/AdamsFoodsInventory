import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Flex, Text, Spinner, Badge, IconButton, Tooltip, Image, Button,
  Alert, AlertIcon,
  Tabs, TabList, TabPanels, Tab, TabPanel,
  Drawer, DrawerOverlay, DrawerContent, DrawerHeader, DrawerFooter,
  Stack, Divider, useDisclosure,
} from "@chakra-ui/react";
import { RepeatIcon, WarningIcon, HamburgerIcon, CloseIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import getRole from "../utils/getRole";
import { IncomingRecordsTab } from "./noblesse/IncomingRecordsTab";
import { ProcessingReportTab } from "./noblesse/ProcessingReportTab";
import { RegistrationFormTab } from "./noblesse/RegistrationFormTab";
import { OutgoingTab } from "./noblesse/OutgoingTab";
import { WeightManifestTab } from "./noblesse/WeightManifestTab";
import { lotNumberForDate, fmtLongDate } from "./noblesse/shared";
import ScannerDiagnostic from "../components/navbar/scannerDiagnostic";
import ScaleDiagnostic from "../components/navbar/scaleDiagnostic";
import ntiLogo from "../assets/nti.jpg";

const REFRESH_INTERVAL_MS = 60 * 1000;

// Processing is dev-only for now, so the rest of the work can ship without it.
// `npm start` is development and `react-scripts build` is production, so a
// deploy hides the tab with no extra step. To turn it on in a real build later,
// set REACT_APP_PROCESSING_TAB=on at build time — no code change needed.
//
// One flag drives the tab, the panel AND the two fetches: gating only the tab
// would leave production polling endpoints nothing renders.
const SHOW_PROCESSING =
  process.env.REACT_APP_PROCESSING_TAB === "on" ||
  process.env.NODE_ENV !== "production";

const NoblesseScreen = () => {
  const navigate = useNavigate();
  const isAdmin  = getRole() === "admin";
  const canEdit  = true; // all roles permitted on this screen are trusted to edit

  // Box weighing belongs to Noblesse Trading, so it lives here rather than in
  // the Adams Foods navbar. The diagnostic sits alongside it because it exists
  // to configure the same scanner.
  const [scanDiagOpen, setScanDiagOpen] = useState(false);
  const [scaleDiagOpen, setScaleDiagOpen] = useState(false);
  const { isOpen: drawerOpen, onOpen: openDrawer, onClose: closeDrawer } = useDisclosure();

  const logOut = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    navigate("/noblesse-login");
  };

  // Runs the action and closes the drawer behind it, matching the Adams navbar.
  const drawerBtn = (label, handler) => (
    <Button bg="white" justifyContent="flex-start"
      onClick={() => { handler(); closeDrawer(); }}>
      {label}
    </Button>
  );

  const [receipts, setReceipts]           = useState([]);
  // Weighed, closed, and on no registration form yet — the work waiting on
  // someone. Drives the tab badge and the notice below the tabs.
  const [unregistered, setUnregistered]   = useState([]);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [tabIndex, setTabIndex]           = useState(0);
  const [ntiInventory, setNtiInventory]   = useState([]);
  const [procOrders, setProcOrders]       = useState([]);
  const [procError, setProcError]         = useState(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [error, setError]                 = useState(null);
  const intervalRef  = useRef(null);
  const fetchDataRef = useRef(null); // always points at the latest fetchData, so the interval never closes over a stale one

  const stopAutoRefresh = () => {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
  };

  const startAutoRefresh = () => {
    if (intervalRef.current) return; // already running
    intervalRef.current = setInterval(() => fetchDataRef.current?.(), REFRESH_INTERVAL_MS);
  };

  const fetchData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      // Receipts stay the load-bearing fetch: if they fail the screen says so.
      // The two processing fetches are tolerated instead, because a failure
      // there should not take Incoming Records and the manifests down with it.
      // Tolerated, NOT swallowed — procError renders in the Processing panel,
      // so an empty tab is never mistaken for "no orders".
      // The unregistered list is tolerated the same way: it is a prompt, not
      // the screen's content, and losing it must not blank Incoming Records.
      const [receiptsRes, invRes, ordersRes, unregRes] = await Promise.all([
        axiosInstance.get("/noblesse-receipts"),
        SHOW_PROCESSING ? axiosInstance.get("/nti-inventory").catch((e) => e) : null,
        SHOW_PROCESSING ? axiosInstance.get("/noblesse-proc-orders").catch((e) => e) : null,
        axiosInstance.get("/box-batches/unregistered").catch((e) => e),
      ]);
      setReceipts(receiptsRes.data || []);
      if (!(unregRes instanceof Error)) setUnregistered(unregRes.data || []);

      if (SHOW_PROCESSING) {
        const failed = [invRes, ordersRes].find((r) => r instanceof Error);
        if (failed) {
          setProcError(failed.response?.data?.error || failed.message);
        } else {
          setProcError(null);
          setNtiInventory(invRes.data || []);
          setProcOrders(ordersRes.data || []);
        }
      }
      // Tabs that load their own data watch this and re-fetch. Without it the
      // timestamp below ticks while their contents stay frozen at page load.
      setRefreshSignal((n) => n + 1);
      setLastRefreshed(new Date());
      setError(null);
      startAutoRefresh();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || err.message || "Failed to load Noblesse data");
      stopAutoRefresh();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  fetchDataRef.current = fetchData;

  useEffect(() => {
    fetchData();
    return () => stopAutoRefresh();
  }, [fetchData]);

  const handleReceiptAdded  = (r) => setReceipts((prev) => [r, ...prev]);
  const handleReceiptUpdate = (r) => setReceipts((prev) => prev.map((x) => x.id === r.id ? r : x));
  const handleReceiptDelete = (id) => setReceipts((prev) => prev.filter((x) => x.id !== id));

  // Any order change moves stock — creating one claims raw, completing one
  // deducts it and puts the output back under the same lot. So the picker's
  // figures are stale the moment an order changes. The 60s poll would catch up
  // eventually; refetching here means the next pick is against real numbers.
  const refreshInventory = useCallback(async () => {
    try {
      const res = await axiosInstance.get("/nti-inventory");
      setNtiInventory(res.data || []);
    } catch (err) {
      console.error("Could not refresh NTI inventory", err);
    }
  }, []);

  const handleProcOrderAdded  = (o) => { setProcOrders((prev) => [o, ...prev]); refreshInventory(); };
  const handleProcOrderUpdate = (o) => { setProcOrders((prev) => prev.map((x) => x.id === o.id ? o : x)); refreshInventory(); };
  const handleProcOrderDelete = (id) => { setProcOrders((prev) => prev.filter((x) => x.id !== id)); refreshInventory(); };

  // Orders still open. Badged so the tab says there is work outstanding
  // without anyone having to open it.
  const pendingProcCount = procOrders.filter((o) => o.status === "pending").length;

  // Chakra pairs tabs to panels BY POSITION and the Processing tab is
  // conditional, so this has to be derived from the same flag that hides it.
  // Hardcoding 2 lands on Weight Manifests in a production build.
  const REGISTRATION_TAB = SHOW_PROCESSING ? 2 : 1;

  if (loading) {
    return (
      <Flex h="100vh" align="center" justify="center" bg="gray.50">
        <Spinner size="xl" color="blue.500" />
      </Flex>
    );
  }

  return (
    <Flex direction="column" h="100vh" overflow="hidden" bg="gray.50">
      <Box bg="white" borderBottom="1px" borderColor="gray.200" px={6} py={4} flexShrink={0}>
        <Flex align="center" justify="space-between">
          <Flex align="center" gap={3}>
            <IconButton icon={<HamburgerIcon />} size="sm" variant="ghost"
              colorScheme="gray" aria-label="Menu" onClick={openDrawer} />
            <Image src={ntiLogo} alt="Noblesse Trading Inc" height="36px" objectFit="contain" />

            {/* Recomputed on every render rather than memoised, so the 60s
                auto-refresh rolls it over shortly after midnight without a
                page reload. */}
            <Box borderLeft="1px solid" borderColor="gray.200" pl={4} ml={1}>
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wide">
                {fmtLongDate()}
              </Text>
              <Flex align="baseline" gap={2}>
                <Text fontSize="xs" color="gray.500">Lot</Text>
                <Text fontSize="lg" fontWeight="bold" color="red.800" lineHeight="1.1">
                  {lotNumberForDate()}
                </Text>
              </Flex>
            </Box>
          </Flex>
          <Flex align="center" gap={3}>
            {lastRefreshed && (
              <Text fontSize="sm" color="gray.400">
                Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </Text>
            )}
            <Tooltip label="Refresh now">
              <IconButton
                icon={refreshing ? <Spinner size="xs" /> : <RepeatIcon />}
                size="sm" variant="ghost" colorScheme="gray"
                aria-label="Refresh" onClick={() => fetchData(true)} isDisabled={refreshing}
              />
            </Tooltip>
          </Flex>
        </Flex>
      </Box>

      {error && (
        <Flex align="center" justify="space-between" bg="red.50" borderBottom="1px" borderColor="red.200"
          px={6} py={2} flexShrink={0}>
          <Flex align="center" gap={2}>
            <WarningIcon color="red.400" boxSize={3.5} />
            <Text fontSize="sm" color="red.600">
              {lastRefreshed
                ? <>Couldn't refresh ({error}). Auto-refresh paused — showing data from{" "}
                    {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</>
                : <>Couldn't load Noblesse Trading data ({error}). Auto-refresh paused — Registration Forms below still work independently.</>
              }
            </Text>
          </Flex>
          <Button size="xs" colorScheme="red" variant="outline" onClick={() => fetchData(true)} isLoading={refreshing}>
            Retry
          </Button>
        </Flex>
      )}

      <Flex flex={1} overflow="hidden" direction="column" p={4} gap={0}>
        {/* Controlled so the notice below can send someone to the right tab.
            The index it uses is derived, never hardcoded — see REGISTRATION_TAB. */}
        <Tabs colorScheme="blue" variant="line" size="sm"
          index={tabIndex} onChange={setTabIndex}
          display="flex" flexDirection="column" flex={1} overflow="hidden">
          {/* The notice rides on the tab row itself. TabList keeps only Tab
              children — Chakra registers those as descendants to pair them with
              panels by position, so a stray child in there is asking for the
              off-by-one this file already carries a warning about. */}
          <Flex align="center" gap={3} mb={3} flexShrink={0} flexWrap="wrap">
          <TabList gap={2} flexWrap="wrap" flex="1 1 auto">
            <Tab>
              Incoming Records
              {receipts.length > 0 && <Badge ml={2} colorScheme="blue" borderRadius="full">{receipts.length}</Badge>}
            </Tab>
            {/* Sits between Incoming and Outgoing because that is the order the
                product actually moves through the building. Gated with the
                panel below on the SAME flag — Chakra pairs tabs to panels by
                position, so hiding one without the other shifts every tab after
                it onto the wrong panel. */}
            {SHOW_PROCESSING && (
              <Tab>
                Processing
                {pendingProcCount > 0 && (
                  <Badge ml={2} colorScheme="yellow" borderRadius="full">{pendingProcCount}</Badge>
                )}
              </Tab>
            )}
            <Tab>
              Registration Forms
              {unregistered.length > 0 && (
                <Badge ml={2} colorScheme="blue" borderRadius="full">{unregistered.length}</Badge>
              )}
            </Tab>
            <Tab>Weight Manifests</Tab>
            <Tab>Outgoing</Tab>
          </TabList>

          {/* Weighed lots nobody has registered yet. Compact, because it sits on
              the tab row — the lots themselves are in the tooltip so the row
              cannot grow and push the panels down. Dismissible (the answer is
              sometimes "not today") but it returns on reload, since the work
              has not gone away. */}
          {unregistered.length > 0 && !noticeDismissed && (
            <Tooltip
              hasArrow
              placement="bottom-end"
              label={
                <Box>
                  {unregistered.slice(0, 6).map((b) => (
                    <Text key={b.batch_id} fontSize="xs">
                      {b.lot_number || `Session ${b.batch_id}`}
                      {b.vendor ? ` · ${b.vendor}` : ""}
                      {` · ${b.box_count} box${b.box_count === 1 ? "" : "es"}`}
                      {` · ${Number(b.total).toFixed(2)} lb`}
                      {b.manifest_name ? ` · manifest "${b.manifest_name}"` : ""}
                    </Text>
                  ))}
                  {unregistered.length > 6 && (
                    <Text fontSize="xs" opacity={0.8}>
                      …and {unregistered.length - 6} more
                    </Text>
                  )}
                </Box>
              }
            >
              <Flex align="center" gap={2} flexShrink={0}
                bg="blue.50" border="1px solid" borderColor="blue.200"
                borderRadius="full" pl={3} pr={1.5} py={1}>
                <WarningIcon color="blue.600" boxSize={3} />
                <Text fontSize="xs" fontWeight="600" color="blue.900" whiteSpace="nowrap">
                  {unregistered.length} weighed lot{unregistered.length === 1 ? "" : "s"} need
                  {unregistered.length === 1 ? "s" : ""} registering
                </Text>
                <Button size="xs" colorScheme="blue" borderRadius="full"
                  onClick={() => setTabIndex(REGISTRATION_TAB)}>
                  Register
                </Button>
                <IconButton
                  aria-label="Dismiss until reload"
                  icon={<CloseIcon boxSize={2} />}
                  size="xs" variant="ghost" colorScheme="blue" borderRadius="full"
                  onClick={() => setNoticeDismissed(true)}
                />
              </Flex>
            </Tooltip>
          )}
          </Flex>

          <Box bg="white" borderRadius="lg" boxShadow="sm" border="1px" borderColor="gray.200"
            flex={1} overflow="hidden" display="flex" flexDirection="column">
            <TabPanels flex={1} overflow="hidden">
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <IncomingRecordsTab
                  receipts={receipts}
                  onReceiptAdded={handleReceiptAdded}
                  onReceiptUpdate={handleReceiptUpdate}
                  onReceiptDelete={handleReceiptDelete}
                  isAdmin={canEdit}
                  canDelete={isAdmin}
                />
              </TabPanel>
              {SHOW_PROCESSING && (
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                {procError && (
                  <Alert status="error" borderRadius="md" mb={4} fontSize="sm">
                    <AlertIcon />
                    <Box>
                      <Text fontWeight="600">Processing data could not be loaded</Text>
                      <Text fontSize="xs" color="gray.700">{procError}</Text>
                    </Box>
                  </Alert>
                )}
                <ProcessingReportTab
                  ntiInventory={ntiInventory}
                  procOrders={procOrders}
                  onProcOrderAdded={handleProcOrderAdded}
                  onProcOrderUpdate={handleProcOrderUpdate}
                  onProcOrderDelete={handleProcOrderDelete}
                  canDelete={isAdmin}
                />
              </TabPanel>
              )}
              {/* There is still no NTI Inventory tab. Stock is visible through
                  the lot picker here and through Outgoing, so it has no screen
                  of its own. The half-built NtiInventoryTab.jsx that used to sit
                  unimported alongside this was deleted rather than left to rot;
                  git history has it if it is ever wanted back. */}
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <RegistrationFormTab isAdmin={canEdit} canDelete={isAdmin}
                  isAdminUser={isAdmin} refreshSignal={refreshSignal} />
              </TabPanel>
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <WeightManifestTab refreshSignal={refreshSignal} />
              </TabPanel>
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <OutgoingTab refreshSignal={refreshSignal} />
              </TabPanel>
            </TabPanels>
          </Box>
        </Tabs>
      </Flex>

      <Drawer placement="left" onClose={closeDrawer} isOpen={drawerOpen}>
        <DrawerOverlay />
        <DrawerContent>
          <DrawerHeader borderBottomWidth="1px">Menu</DrawerHeader>
          <Stack direction="column" spacing={3} p={4}>
            {drawerBtn("Refresh Data", () => fetchData(true))}

            {isAdmin && (
              <>
                <Divider />
                {drawerBtn("Scanner Diagnostic", () => setScanDiagOpen(true))}
                {drawerBtn("Scale Diagnostic", () => setScaleDiagOpen(true))}
                <Divider />
                {drawerBtn("← Adams Foods", () => navigate("/home"))}
              </>
            )}
          </Stack>

          <DrawerFooter justifyContent="center">
            <Button bg="red.400" color="black"
              _hover={{ bg: "red.500", color: "white" }} onClick={logOut}>
              Log Out
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Both diagnostics are admin-only, gated here AND on the menu entry that
          opens them. Unlike the admin gates that guard data (which must be
          enforced server-side — see CLAUDE.md §8), these guard no server
          resource at all: they read hardware attached to the operator's own
          machine. There is nothing to leak and nothing to mutate, so keeping
          them out of the way is the whole requirement. */}
      {isAdmin && (
        <>
          <ScannerDiagnostic isOpen={scanDiagOpen} onClose={() => setScanDiagOpen(false)} />
          <ScaleDiagnostic isOpen={scaleDiagOpen} onClose={() => setScaleDiagOpen(false)} />
        </>
      )}
    </Flex>
  );
};

export default NoblesseScreen;
