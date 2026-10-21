import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, Spinner, Flex, Table, Thead, Tbody, Tr, Th, Td, useToast } from "@chakra-ui/react";
import FloatingWindow from "../../components/FloatingWindow";
import axiosInstance from "../../utils/axiosInstance";
import useLang from "../../hooks/useLang";
import LangToggle from "../../components/LangToggle";
import FpReturnForm from "./FpReturnForm";

// The incoming dock's view of the freezer: what is still out, and counting it back in.

const num = { style: { fontVariantNumeric: "tabular-nums" } };

const FpReturnWindow = ({ isOpen, onClose }) => {
  const toast = useToast();
  const { lang, t, toggle: toggleLang } = useLang();
  const [fpLots, setFpLots] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axiosInstance.get("/fp-lots");
      setFpLots(data || []);
    } catch (err) {
      toast({ title: t("Could not load the F.P Tracker"), description: err.response?.data?.error || err.message,
        status: "error", duration: 6000, position: "top", isClosable: true });
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const out = useMemo(() => fpLots.filter((l) => l.inFreezer > 0), [fpLots]);

  return (
    <FloatingWindow isOpen={isOpen} onClose={onClose} title={t("Back from the freezer")} width={760}
      headerActions={<LangToggle lang={lang} onToggle={toggleLang} />}>
      <Text fontSize="xs" color="gray.500" mb={3}>
        {t("Product coming back from the AF freezer. Count the cases; they are not weighed. A run on them picks the FP lot on the Processing tab.")}
      </Text>

      <FpReturnForm fpLots={fpLots} onRecorded={load} />

      <Text fontSize="xs" fontWeight="700" color="gray.600" textTransform="uppercase" mt={4} mb={1}>
        {t("Still in the freezer")}
      </Text>
      {loading && fpLots.length === 0 ? (
        <Flex justify="center" py={4}><Spinner size="sm" /></Flex>
      ) : out.length === 0 ? (
        <Text fontSize="sm" color="gray.500">{t("Nothing is in the freezer")}</Text>
      ) : (
        <Box overflowX="auto" border="1px solid" borderColor="gray.200" borderRadius="md" bg="white">
          <Table size="sm" minWidth="560px">
            <Thead>
              <Tr>
                <Th>{t("Lot #")}</Th><Th>{t("FP lot")}</Th><Th>{t("Item description")}</Th>
                <Th isNumeric>{t("Sent")}</Th><Th isNumeric>{t("Back")}</Th><Th isNumeric>{t("In freezer")}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {out.map((l) => (
                <Tr key={l.lotId}>
                  <Td fontWeight="600" color="blue.700">{l.parentLotNumber}</Td>
                  <Td whiteSpace="nowrap">{l.lotNumber}</Td>
                  <Td>{l.description || "—"}</Td>
                  <Td isNumeric {...num}>{l.sent}</Td>
                  <Td isNumeric {...num}>{l.returned}</Td>
                  <Td isNumeric {...num} fontWeight="600">{l.inFreezer}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      )}
    </FloatingWindow>
  );
};

export default FpReturnWindow;
