import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Flex, Text, Spinner, Badge, IconButton, Tooltip,
  Tabs, TabList, TabPanels, Tab, TabPanel,
} from "@chakra-ui/react";
import { RepeatIcon, ArrowBackIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import getRole from "../utils/getRole";
import { PendingOrdersTab } from "./noblesse/PendingOrdersTab";
import { IncomingRecordsTab } from "./noblesse/IncomingRecordsTab";
import { NtiInventoryTab } from "./noblesse/NtiInventoryTab";
import { ProcessingReportTab } from "./noblesse/ProcessingReportTab";

const REFRESH_INTERVAL_MS = 60 * 1000;

const NoblesseScreen = () => {
  const navigate = useNavigate();
  const isAdmin  = getRole() === "admin";

  const [pendingOrders, setPendingOrders] = useState([]);
  const [ntiInventory, setNtiInventory]   = useState([]);
  const [receipts, setReceipts]           = useState([]);
  const [afItems, setAfItems]             = useState([]);
  const [procOrders, setProcOrders]       = useState([]);
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
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
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    axiosInstance.get("/noblesse-proc-orders")
      .then((res) => setProcOrders(res.data || []))
      .catch((err) => console.error("proc-orders fetch:", err.message));
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(() => fetchData(), REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  const handleReceiptAdded  = (r) => setReceipts((prev) => [r, ...prev]);
  const handleReceiptUpdate = (r) => setReceipts((prev) => prev.map((x) => x.id === r.id ? r : x));

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
            <Box>
              <Text fontSize="xl" fontWeight="bold" color="gray.800">Noblesse Trading Inc</Text>
              <Text fontSize="sm" color="gray.500">Processor Portal</Text>
            </Box>
          </Flex>
          <Flex align="center" gap={3}>
            {lastRefreshed && (
              <Text fontSize="xs" color="gray.400">
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

      <Flex flex={1} overflow="hidden" direction="column" p={4} gap={0}>
        <Tabs colorScheme="blue" variant="line" size="sm"
          display="flex" flexDirection="column" flex={1} overflow="hidden">
          <TabList mb={3} gap={2} flexWrap="wrap" flexShrink={0}>
            <Tab>
              Pending Orders
              {ntiInventory.length > 0 && <Badge ml={2} colorScheme="blue" borderRadius="full">{ntiInventory.length}</Badge>}
            </Tab>
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
          </TabList>

          <Box bg="white" borderRadius="lg" boxShadow="sm" border="1px" borderColor="gray.200"
            flex={1} overflow="hidden" display="flex" flexDirection="column">
            <TabPanels flex={1} overflow="hidden">
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <PendingOrdersTab ntiInventory={ntiInventory} />
              </TabPanel>
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <IncomingRecordsTab
                  receipts={receipts}
                  onReceiptAdded={handleReceiptAdded}
                  onReceiptUpdate={handleReceiptUpdate}
                  isAdmin={isAdmin}
                />
              </TabPanel>
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <ProcessingReportTab
                  ntiInventory={ntiInventory}
                  procOrders={procOrders}
                  onProcOrderAdded={handleProcOrderAdded}
                  onProcOrderUpdate={handleProcOrderUpdate}
                />
              </TabPanel>
              <TabPanel h="100%" overflowY="auto" overflowX="hidden" p={5}>
                <NtiInventoryTab
                  ntiInventory={ntiInventory} afItems={afItems}
                  procOrders={procOrders}
                  onAdd={handleNtiAdd} onUpdate={handleNtiUpdate} onDelete={handleNtiDelete}
                  isAdmin={isAdmin}
                />
              </TabPanel>
            </TabPanels>
          </Box>
        </Tabs>
      </Flex>
    </Flex>
  );
};

export default NoblesseScreen;
