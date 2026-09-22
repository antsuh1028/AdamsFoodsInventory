import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Box,
  Flex,
  Text,
  Spinner,
  Badge,
  IconButton,
  Tooltip,
  Image,
  Button,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  Stack,
  Divider,
  useDisclosure,
} from "@chakra-ui/react";
import {
  RepeatIcon,
  WarningIcon,
  HamburgerIcon,
  CloseIcon,
} from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import getRole, { isOutgoingOnly } from "../utils/getRole";
// eslint-disable-next-line no-unused-vars -- Incoming Records is commented out below, not removed
import { IncomingRecordsTab } from "./noblesse/IncomingRecordsTab";
import ProcessingReportsTab from "./noblesse/ProcessingReportsTab";
import { RegistrationFormTab } from "./noblesse/RegistrationFormTab";
import { OutgoingTab } from "./noblesse/OutgoingTab";
import { WeightManifestTab } from "./noblesse/WeightManifestTab";
import { lotNumberForDate, fmtLongDate } from "./noblesse/shared";
import ScannerDiagnostic from "../components/navbar/scannerDiagnostic";
import ScaleDiagnostic from "../components/navbar/scaleDiagnostic";
import DailyReport from "./noblesse/DailyReport";
import ntiLogo from "../assets/nti.jpg";

const REFRESH_INTERVAL_MS = 60 * 1000;

const NoblesseScreen = () => {
  const navigate = useNavigate();
  const isAdmin = getRole() === "admin";
  // The report is admin + manager, matching the gate on the route itself.
  const canSeeReport = ["admin", "manager"].includes(getRole());
  const canEdit = true; // all roles permitted on this screen are trusted to edit
  // Outgoing is the only tab this role has, so the rest are not rendered and
  // the screen-level fetches behind them are not made.
  const outgoingOnly = isOutgoingOnly();

  // Box weighing belongs to Noblesse Trading, so it lives here rather than in
  // the Adams Foods navbar. The diagnostic sits alongside it because it exists
  // to configure the same scanner.
  const [scanDiagOpen, setScanDiagOpen] = useState(false);
  const [scaleDiagOpen, setScaleDiagOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const {
    isOpen: drawerOpen,
    onOpen: openDrawer,
    onClose: closeDrawer,
  } = useDisclosure();

  const logOut = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    navigate("/noblesse-login");
  };

  // Runs the action and closes the drawer behind it, matching the Adams navbar.
  const drawerBtn = (label, handler) => (
    <Button
      bg="white"
      justifyContent="flex-start"
      onClick={() => {
        handler();
        closeDrawer();
      }}
    >
      {label}
    </Button>
  );

  // Still fetched and still counted on the hidden Incoming tab's badge, so
  // uncommenting that tab needs no other change.
  // eslint-disable-next-line no-unused-vars
  const [receipts, setReceipts] = useState([]);
  // Weighed, closed, and on no registration form yet — the work waiting on
  // someone. Drives the tab badge and the notice below the tabs.
  const [unregistered, setUnregistered] = useState([]);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // Submitted reports waiting on reception. Drives the tab badge and the nudge.
  const [waitingReports, setWaitingReports] = useState(0);
  const [tabIndex, setTabIndex] = useState(0);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);
  const fetchDataRef = useRef(null); // always points at the latest fetchData, so the interval never closes over a stale one

  const stopAutoRefresh = () => {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
  };

  const startAutoRefresh = () => {
    if (intervalRef.current) return; // already running
    intervalRef.current = setInterval(
      () => fetchDataRef.current?.(),
      REFRESH_INTERVAL_MS,
    );
  };

  const fetchData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      // All three belong to tabs this role does not have, and the server
      // refuses them — asking anyway would fail the load-bearing one and blank
      // the screen on its own gate.
      if (!outgoingOnly) {
        // Receipts stay the load-bearing fetch: if they fail the screen says so.
        // The other two are prompts, not content, so losing either must not blank
        // Incoming Records.
        const [receiptsRes, unregRes, reportsRes] = await Promise.all([
          axiosInstance.get("/noblesse-receipts"),
          axiosInstance.get("/box-batches/unregistered").catch((e) => e),
          axiosInstance
            .get("/processing-reports", { params: { status: "submitted" } })
            .catch((e) => e),
        ]);
        setReceipts(receiptsRes.data || []);
        if (!(unregRes instanceof Error)) setUnregistered(unregRes.data || []);
        // Only for the tab badge; the tab fetches its own list.
        if (!(reportsRes instanceof Error))
          setWaitingReports((reportsRes.data || []).length);
      }

      // Tabs that load their own data watch this and re-fetch. Without it the
      // timestamp below ticks while their contents stay frozen at page load.
      setRefreshSignal((n) => n + 1);
      setLastRefreshed(new Date());
      setError(null);
      startAutoRefresh();
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.error ||
          err.message ||
          "Failed to load Noblesse data",
      );
      stopAutoRefresh();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [outgoingOnly]);

  fetchDataRef.current = fetchData;

  useEffect(() => {
    fetchData();
    return () => stopAutoRefresh();
  }, [fetchData]);

  /* eslint-disable no-unused-vars -- passed to the hidden Incoming tab */
  const handleReceiptAdded = (r) => setReceipts((prev) => [r, ...prev]);
  const handleReceiptUpdate = (r) =>
    setReceipts((prev) => prev.map((x) => (x.id === r.id ? r : x)));
  const handleReceiptDelete = (id) =>
    setReceipts((prev) => prev.filter((x) => x.id !== id));
  /* eslint-enable no-unused-vars */

  // Positions in the TabList, counting only the tabs that are rendered.
  // Incoming is commented out, so everything shifted up by one — Chakra pairs
  // tabs to panels by position and these buttons jump by index, so hiding a tab
  // moves both.
  // Outgoing-only drops the three before it, so it becomes the only tab and
  // these two address nothing. Both notices that use them are hidden in that
  // case anyway — their counts come from fetches this role does not make.
  const REGISTRATION_TAB = outgoingOnly ? -1 : 0;
  const PROCESSING_TAB = outgoingOnly ? -1 : 2;

  if (loading) {
    return (
      <Flex h="100vh" align="center" justify="center" bg="gray.50">
        <Spinner size="xl" color="blue.500" />
      </Flex>
    );
  }

  return (
    <Flex direction="column" h="100vh" overflow="hidden" bg="gray.50">
      <Box
        bg="white"
        borderBottom="1px"
        borderColor="gray.200"
        px={{ base: 3, md: 6 }}
        py={{ base: 2, md: 4 }}
        flexShrink={0}
      >
        <Flex align="center" justify="space-between" gap={2}>
          {/* minW 0 so this half can actually shrink: a flex item defaults to
              its content width, which is what pushed the date off the screen
              instead of letting it give way. */}
          <Flex align="center" gap={{ base: 2, md: 3 }} minW={0}>
            <IconButton
              icon={<HamburgerIcon />}
              size="sm"
              variant="ghost"
              colorScheme="gray"
              aria-label="Menu"
              onClick={openDrawer}
            />
            <Image
              src={ntiLogo}
              alt="Noblesse Trading Inc"
              height={{ base: "26px", md: "36px" }}
              objectFit="contain"
              flexShrink={0}
            />

            {/* Recomputed on every render rather than memoised, so the 60s
                auto-refresh rolls it over shortly after midnight without a
                page reload. */}
            <Box
              borderLeft={{ base: "none", md: "1px solid" }}
              borderColor="gray.200"
              pl={{ base: 0, md: 4 }}
              ml={{ base: 0, md: 1 }}
              minW={0}
            >
              {/* "TUESDAY, SEPTEMBER 15, 2026" is most of a phone's width and
                  the device already shows the date. The lot number below is the
                  part that belongs to the day's work, so that stays. */}
              <Text
                fontSize="xs"
                color="gray.500"
                textTransform="uppercase"
                letterSpacing="wide"
                display={{ base: "none", md: "block" }}
              >
                {fmtLongDate()}
              </Text>
              <Flex align="baseline" gap={2} minW={0}>
                <Text fontSize="xs" color="gray.500" flexShrink={0}>
                  Lot
                </Text>
                <Text
                  fontSize={{ base: "sm", md: "lg" }}
                  fontWeight="bold"
                  color="red.800"
                  lineHeight="1.1"
                  whiteSpace="nowrap"
                >
                  {lotNumberForDate()}
                </Text>
              </Flex>
            </Box>
          </Flex>
          <Flex align="center" gap={3} flexShrink={0}>
            {/* The refresh button stays at every width; the timestamp beside it
                is the first thing to go, since the spinner already says when a
                refresh is happening. */}
            {lastRefreshed && (
              <Text fontSize="sm" color="gray.400" whiteSpace="nowrap"
                display={{ base: "none", md: "block" }}>
                Updated{" "}
                {lastRefreshed.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </Text>
            )}
            <Tooltip label="Refresh now">
              <IconButton
                icon={refreshing ? <Spinner size="xs" /> : <RepeatIcon />}
                size="sm"
                variant="ghost"
                colorScheme="gray"
                aria-label="Refresh"
                onClick={() => fetchData(true)}
                isDisabled={refreshing}
              />
            </Tooltip>
          </Flex>
        </Flex>
      </Box>

      {error && (
        <Flex
          align="center"
          justify="space-between"
          bg="red.50"
          borderBottom="1px"
          borderColor="red.200"
          px={{ base: 3, md: 6 }}
          py={2}
          flexShrink={0}
        >
          <Flex align="center" gap={2}>
            <WarningIcon color="red.400" boxSize={3.5} />
            <Text fontSize="sm" color="red.600">
              {lastRefreshed ? (
                <>
                  Couldn't refresh ({error}). Auto-refresh paused — showing data
                  from{" "}
                  {lastRefreshed.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  .
                </>
              ) : (
                <>
                  Couldn't load Noblesse Trading data ({error}). Auto-refresh
                  paused — Registration Forms below still work independently.
                </>
              )}
            </Text>
          </Flex>
          <Button
            size="xs"
            colorScheme="red"
            variant="outline"
            onClick={() => fetchData(true)}
            isLoading={refreshing}
          >
            Retry
          </Button>
        </Flex>
      )}

      <Flex flex={1} overflow="hidden" direction="column" p={{ base: 2, md: 4 }} gap={0}>
        {/* Controlled so the notice below can send someone to the right tab.
            The index it uses is derived, never hardcoded — see REGISTRATION_TAB. */}
        <Tabs
          colorScheme="blue"
          variant="line"
          size="sm"
          index={tabIndex}
          onChange={setTabIndex}
          display="flex"
          flexDirection="column"
          flex={1}
          overflow="hidden"
        >
          {/* The notice rides on the tab row itself. TabList keeps only Tab
              children — Chakra registers those as descendants to pair them with
              panels by position, so a stray child in there is asking for the
              off-by-one this file already carries a warning about. */}
          <Flex align="center" gap={3} mb={3} flexShrink={0} flexWrap="wrap">
            <TabList gap={2} flexWrap="wrap" flex="1 1 auto">
              {/* <Tab>
              Incoming Records
              {receipts.length > 0 && <Badge ml={2} colorScheme="blue" borderRadius="full">{receipts.length}</Badge>}
            </Tab> */}
              {/* Sits between Incoming and Outgoing because that is the order the
                product actually moves through the building. Chakra pairs tabs
                to panels by position, so a tab and its panel must always be
                added or removed together. */}
              {/* One condition per Tab, matching the panels below one for one. */}
              {!outgoingOnly && (
                <Tab>
                  Registration Forms
                  {unregistered.length > 0 && (
                    <Badge ml={2} colorScheme="blue" borderRadius="full">
                      {unregistered.length}
                    </Badge>
                  )}
                </Tab>
              )}
              {!outgoingOnly && <Tab>Weight Manifests</Tab>}
              {!outgoingOnly && (
                <Tab>
                  Processing
                  {waitingReports > 0 && (
                    <Badge ml={2} colorScheme="yellow" borderRadius="full">
                      {waitingReports}
                    </Badge>
                  )}
                </Tab>
              )}

              <Tab>Outgoing</Tab>
            </TabList>

            {/* Weighed lots nobody has registered yet. Compact, because it sits on
              the tab row — the lots themselves are in the tooltip so the row
              cannot grow and push the panels down. Dismissible (the answer is
              sometimes "not today") but it returns on reload, since the work
              has not gone away. */}
            {/* Reception works on the Registration Forms tab, so without this a
              waiting report is only found by opening a form and noticing.
              Same shape as the registering nudge beside it. */}
            {waitingReports > 0 && (
              <Flex
                align="center"
                gap={2}
                flexShrink={0}
                bg="yellow.50"
                border="1px solid"
                borderColor="yellow.300"
                borderRadius="full"
                pl={3}
                pr={1.5}
                py={1}
              >
                <WarningIcon color="yellow.700" boxSize={3} />
                <Text
                  fontSize="xs"
                  fontWeight="600"
                  color="yellow.900"
                  whiteSpace="nowrap"
                >
                  {waitingReports} processing report
                  {waitingReports === 1 ? "" : "s"} waiting
                </Text>
                <Button
                  size="xs"
                  colorScheme="yellow"
                  borderRadius="full"
                  onClick={() => setTabIndex(PROCESSING_TAB)}
                >
                  Review
                </Button>
              </Flex>
            )}

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
                        {b.manifest_name
                          ? ` · manifest "${b.manifest_name}"`
                          : ""}
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
                <Flex
                  align="center"
                  gap={2}
                  flexShrink={0}
                  bg="blue.50"
                  border="1px solid"
                  borderColor="blue.200"
                  borderRadius="full"
                  pl={3}
                  pr={1.5}
                  py={1}
                >
                  <WarningIcon color="blue.600" boxSize={3} />
                  <Text
                    fontSize="xs"
                    fontWeight="600"
                    color="blue.900"
                    whiteSpace="nowrap"
                  >
                    {unregistered.length} weighed lot
                    {unregistered.length === 1 ? "" : "s"} need
                    {unregistered.length === 1 ? "s" : ""} registering
                  </Text>
                  <Button
                    size="xs"
                    colorScheme="blue"
                    borderRadius="full"
                    onClick={() => setTabIndex(REGISTRATION_TAB)}
                  >
                    Register
                  </Button>
                  <IconButton
                    aria-label="Dismiss until reload"
                    icon={<CloseIcon boxSize={2} />}
                    size="xs"
                    variant="ghost"
                    colorScheme="blue"
                    borderRadius="full"
                    onClick={() => setNoticeDismissed(true)}
                  />
                </Flex>
              </Tooltip>
            )}
          </Flex>

          <Box
            bg="white"
            borderRadius="lg"
            boxShadow="sm"
            border="1px"
            borderColor="gray.200"
            flex={1}
            overflow="hidden"
            display="flex"
            flexDirection="column"
          >
            <TabPanels flex={1} overflow="hidden">
              {/* <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={{ base: 3, md: 5 }}>
                <IncomingRecordsTab
                  receipts={receipts}
                  onReceiptAdded={handleReceiptAdded}
                  onReceiptUpdate={handleReceiptUpdate}
                  onReceiptDelete={handleReceiptDelete}
                  isAdmin={canEdit}
                  canDelete={isAdmin}
                />
              </TabPanel> */}

              {/* There is still no NTI Inventory tab. Stock is visible through
                  the lot picker here and through Outgoing, so it has no screen
                  of its own. The half-built NtiInventoryTab.jsx that used to sit
                  unimported alongside this was deleted rather than left to rot;
                  git history has it if it is ever wanted back. */}
              {/* Paired with the three Tabs above — Chakra matches them by
                  POSITION, so each panel carries its own condition. A fragment
                  around the three counts as one child and the pairing slips:
                  that is the off-by-one this file warns about, and it blanks
                  whichever tab lands past the gap. */}
              {!outgoingOnly && (
                <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={{ base: 3, md: 5 }}>
                  <RegistrationFormTab
                    isAdmin={canEdit}
                    canDelete={isAdmin}
                    isAdminUser={isAdmin}
                    refreshSignal={refreshSignal}
                  />
                </TabPanel>
              )}
              {!outgoingOnly && (
                <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={{ base: 3, md: 5 }}>
                  <WeightManifestTab refreshSignal={refreshSignal} />
                </TabPanel>
              )}
              {!outgoingOnly && (
                <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={{ base: 3, md: 5 }}>
                  <ProcessingReportsTab refreshSignal={refreshSignal} />
                </TabPanel>
              )}

              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={{ base: 3, md: 5 }}>
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

            {canSeeReport && (
              <>
                <Divider />
                {drawerBtn("Daily Report", () => setReportOpen(true))}
              </>
            )}

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
            <Button
              bg="red.400"
              color="black"
              _hover={{ bg: "red.500", color: "white" }}
              onClick={logOut}
            >
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
      {/* Unlike the diagnostics below, this reads the whole tenant's figures,
          so the gate that matters is requireRole on the route. This one only
          keeps it out of the way of people it is not for. */}
      {canSeeReport && (
        <DailyReport isOpen={reportOpen} onClose={() => setReportOpen(false)} />
      )}

      {isAdmin && (
        <>
          <ScannerDiagnostic
            isOpen={scanDiagOpen}
            onClose={() => setScanDiagOpen(false)}
          />
          <ScaleDiagnostic
            isOpen={scaleDiagOpen}
            onClose={() => setScaleDiagOpen(false)}
          />
        </>
      )}
    </Flex>
  );
};

export default NoblesseScreen;
