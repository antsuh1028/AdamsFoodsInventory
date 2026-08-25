import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Flex, Text, Spinner, Badge, IconButton, Tooltip, Image, Button,
  Tabs, TabList, TabPanels, Tab, TabPanel,
} from "@chakra-ui/react";
import { RepeatIcon, ArrowBackIcon, WarningIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import getRole from "../utils/getRole";
import { IncomingRecordsTab } from "./noblesse/IncomingRecordsTab";
import { NtiInventoryTab } from "./noblesse/NtiInventoryTab";
import { ProcessingReportTab } from "./noblesse/ProcessingReportTab";
import { RegistrationFormTab } from "./noblesse/RegistrationFormTab";
import ntiLogo from "../assets/nti.jpg";

const REFRESH_INTERVAL_MS = 60 * 1000;

const NoblesseScreen = () => {
  const navigate = useNavigate();
  const isAdmin  = getRole() === "admin";
  const canEdit  = true; // all roles permitted on this screen are trusted to edit

  const [pendingOrders, setPendingOrders] = useState([]);
  const [ntiInventory, setNtiInventory]   = useState([]);
  const [receipts, setReceipts]           = useState([]);
  const [afItems, setAfItems]             = useState([]);
  const [procOrders, setProcOrders]       = useState([]);
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
    let backendReachable = false;
    try {
      const [ordersRes, ntiInvRes, receiptsRes, afItemsRes] = await Promise.all([
        axiosInstance.get("/production-orders?status=pending"),
        axiosInstance.get("/nti-inventory"),
        axiosInstance.get("/noblesse-receipts"),
        axiosInstance.get("/nti-production-items"),
      ]);
      setPendingOrders(ordersRes.data || []);
      setNtiInventory(ntiInvRes.data || []);
      setReceipts(receiptsRes.data || []);
      setAfItems(afItemsRes.data || []);
      setLastRefreshed(new Date());
      setError(null);
      backendReachable = true;
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || err.message || "Failed to load Noblesse data");
      // Stop polling — retrying on a fixed interval against a failing backend
      // just spams the same error, so leave it to the manual Refresh button.
      stopAutoRefresh();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }

    // Skip this entirely once we already know the backend is unreachable —
    // no point firing another request that's just going to fail the same way.
    if (!backendReachable) return;

    try {
      const res = await axiosInstance.get("/noblesse-proc-orders");
      setProcOrders(res.data || []);
      startAutoRefresh(); // (re)arm only once every endpoint in this cycle has succeeded
    } catch (err) {
      console.error("proc-orders fetch:", err.message);
      setError(err.response?.data?.error || err.message || "Failed to load processing orders");
      stopAutoRefresh();
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
  const handleInventoryPush = (items) => setNtiInventory((prev) => [...items, ...prev]);

  const handleProcOrderAdded = async (o) => {
    setProcOrders((prev) => [o, ...prev]);
    try {
      const res = await axiosInstance.get("/nti-inventory");
      setNtiInventory(res.data || []);
    } catch (err) {
      console.error("nti re-fetch:", err.message);
    }
  };
  const handleProcOrderUpdate = (o) => setProcOrders((prev) => prev.map((x) => x.id === o.id ? o : x));
  const handleProcOrderDelete = (id) => setProcOrders((prev) => prev.filter((x) => x.id !== id));

  const handleNtiAdd    = (item) => setNtiInventory((prev) => [item, ...prev]);
  const handleNtiUpdate = (item) => setNtiInventory((prev) => prev.map((x) => x.id === item.id ? item : x));
  const handleNtiDelete = (id)   => setNtiInventory((prev) => prev.filter((x) => x.id !== id));

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
            {isAdmin && (
              <Tooltip label="Back to Adams Foods">
                <IconButton icon={<ArrowBackIcon />} size="sm" variant="ghost"
                  colorScheme="gray" aria-label="Back" onClick={() => navigate("/home")} />
              </Tooltip>
            )}
            <Image src={ntiLogo} alt="Noblesse Trading Inc" height="36px" objectFit="contain" />
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
            <Button size="sm" variant="ghost" colorScheme="red"
              onClick={() => { localStorage.removeItem("token"); navigate("/noblesse-login"); }}>
              Log out
            </Button>
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
            <Tab>
              Processing Report
              {procOrders.filter((o) => o.status === "pending").length > 0 && (
                <Badge ml={2} colorScheme="yellow" borderRadius="full">
                  {procOrders.filter((o) => o.status === "pending").length}
                </Badge>
              )}
            </Tab>
            <Tab>
              NTI Inventory
              {ntiInventory.length > 0 && <Badge ml={2} colorScheme="green" borderRadius="full">{ntiInventory.length}</Badge>}
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
                  onInventoryPush={handleInventoryPush}
                  isAdmin={canEdit}
                  canDelete={isAdmin}
                />
              </TabPanel>
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <ProcessingReportTab
                  ntiInventory={ntiInventory}
                  procOrders={procOrders}
                  onProcOrderAdded={handleProcOrderAdded}
                  onProcOrderUpdate={handleProcOrderUpdate}
                  onProcOrderDelete={handleProcOrderDelete}
                  canDelete={isAdmin}
                />
              </TabPanel>
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <NtiInventoryTab
                  ntiInventory={ntiInventory} afItems={afItems}
                  procOrders={procOrders}
                  onAdd={handleNtiAdd} onUpdate={handleNtiUpdate} onDelete={handleNtiDelete}
                  isAdmin={canEdit}
                  canDelete={isAdmin}
                />
              </TabPanel>
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <RegistrationFormTab isAdmin={canEdit} canDelete={isAdmin} />
              </TabPanel>
            </TabPanels>
          </Box>
        </Tabs>
      </Flex>
    </Flex>
  );
};

export default NoblesseScreen;
