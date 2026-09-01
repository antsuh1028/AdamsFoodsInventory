import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Flex, Text, Spinner, Badge, IconButton, Tooltip, Image, Button,
  Tabs, TabList, TabPanels, Tab, TabPanel,
  Drawer, DrawerOverlay, DrawerContent, DrawerHeader, DrawerFooter,
  Stack, Divider, useDisclosure,
} from "@chakra-ui/react";
import { RepeatIcon, WarningIcon, HamburgerIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import getRole from "../utils/getRole";
import { IncomingRecordsTab } from "./noblesse/IncomingRecordsTab";
import { RegistrationFormTab } from "./noblesse/RegistrationFormTab";
import { lotNumberForDate, fmtLongDate } from "./noblesse/shared";
import BoxScanner from "../components/navbar/boxScanner";
import ScannerDiagnostic from "../components/navbar/scannerDiagnostic";
import ntiLogo from "../assets/nti.jpg";

const REFRESH_INTERVAL_MS = 60 * 1000;

const NoblesseScreen = () => {
  const navigate = useNavigate();
  const isAdmin  = getRole() === "admin";
  const canEdit  = true; // all roles permitted on this screen are trusted to edit

  // Box weighing belongs to Noblesse Trading, so it lives here rather than in
  // the Adams Foods navbar. The diagnostic sits alongside it because it exists
  // to configure the same scanner.
  const [boxScanOpen, setBoxScanOpen] = useState(false);
  const [scanDiagOpen, setScanDiagOpen] = useState(false);
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
      const receiptsRes = await axiosInstance.get("/noblesse-receipts");
      setReceipts(receiptsRes.data || []);
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
        <Tabs colorScheme="blue" variant="line" size="sm"
          display="flex" flexDirection="column" flex={1} overflow="hidden">
          <TabList mb={3} gap={2} flexWrap="wrap" flexShrink={0}>
            <Tab>
              Incoming Records
              {receipts.length > 0 && <Badge ml={2} colorScheme="blue" borderRadius="full">{receipts.length}</Badge>}
            </Tab>
            <Tab>Registration Forms</Tab>
          </TabList>

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
              {/* Processing Report & NTI Inventory tabs disabled for now */}
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <RegistrationFormTab isAdmin={canEdit} canDelete={isAdmin}
                  isAdminUser={isAdmin} refreshSignal={refreshSignal} />
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
            {drawerBtn("Box Weighing", () => setBoxScanOpen(true))}
            {drawerBtn("Refresh Data", () => fetchData(true))}

            {isAdmin && (
              <>
                <Divider />
                {drawerBtn("Scanner Diagnostic", () => setScanDiagOpen(true))}
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

      <BoxScanner isOpen={boxScanOpen} onClose={() => setBoxScanOpen(false)} />
      {isAdmin && (
        <ScannerDiagnostic isOpen={scanDiagOpen} onClose={() => setScanDiagOpen(false)} />
      )}
    </Flex>
  );
};

export default NoblesseScreen;
