import React, { useMemo, useState } from "react";
import { Box, Flex, Text, Input, Button, Select, useToast } from "@chakra-ui/react";
import axiosInstance from "../../utils/axiosInstance";
import { today } from "../common/shared";
import useLang from "../../hooks/useLang";

// Counting product back in from the AF freezer: cases, not weighed. A partial
// return is just one of several. `fpLots` is the /fp-lots list; `onRecorded` reloads it.

const EMPTY = () => ({ lotId: "", cases: "", returnedOn: today(), notes: "" });

const FpReturnForm = ({ fpLots = [], onRecorded }) => {
  const toast = useToast();
  const { t } = useLang();
  const [ret, setRet] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  // Only lots with something still in the freezer can have a return counted.
  const out = useMemo(() => fpLots.filter((l) => l.inFreezer > 0), [fpLots]);
  const picked = out.find((l) => String(l.parentLotId) === String(ret.lotId));
  const tooMany = picked && Number(ret.cases) > picked.inFreezer;
  const ready = ret.lotId && Number(ret.cases) > 0 && !tooMany;

  const record = async () => {
    setBusy(true);
    try {
      const { data } = await axiosInstance.post("/fp-returns", {
        lotId: Number(ret.lotId), cases: ret.cases, returnedOn: ret.returnedOn, notes: ret.notes,
      });
      toast({ title: t("{n} cases back on {lot}", { n: ret.cases, lot: data.fpLotNumber }), status: "success",
        duration: 5000, position: "top",
        description: t("{inFreezer} still in the freezer, {ready} ready to run.", { inFreezer: data.inFreezer, ready: data.ready }) });
      setRet(EMPTY());
      if (onRecorded) await onRecorded();
    } catch (err) {
      toast({ title: t("That did not save"), description: err.response?.data?.error || err.message,
        status: "error", duration: 6000, position: "top", isClosable: true });
    } finally {
      setBusy(false);
    }
  };

  const cellInput = { size: "sm", bg: "white" };

  return (
    <Flex gap={2} wrap="wrap" align="flex-end" p={3} bg="teal.50" borderRadius="md"
      border="1px solid" borderColor="teal.200">
      <Text fontSize="xs" fontWeight="700" color="teal.800" textTransform="uppercase" w="100%">
        {t("Back from the freezer")}
      </Text>
      <Box>
        <Text fontSize="xs" color="gray.500" mb={1}>{t("Date back")}</Text>
        <Input {...cellInput} type="date" max={today()} width="150px"
          value={ret.returnedOn} onChange={(e) => setRet({ ...ret, returnedOn: e.target.value })} />
      </Box>
      <Box minW="260px">
        <Text fontSize="xs" color="gray.500" mb={1}>{t("Lot")}</Text>
        <Select size="sm" bg="white" placeholder={out.length ? t("Pick the lot") : t("Nothing is in the freezer")}
          isDisabled={!out.length}
          value={ret.lotId} onChange={(e) => setRet({ ...ret, lotId: e.target.value })}>
          {out.map((l) => (
            <option key={l.lotId} value={l.parentLotId}>
              {t("{lot} ({fp}): {n} in the freezer", { lot: l.parentLotNumber, fp: l.lotNumber, n: l.inFreezer })}
            </option>
          ))}
        </Select>
      </Box>
      <Box>
        <Text fontSize="xs" color="gray.500" mb={1}>{t("Cases back")}</Text>
        <Input {...cellInput} width="90px" inputMode="numeric"
          value={ret.cases} onChange={(e) => setRet({ ...ret, cases: e.target.value.replace(/\D/g, "") })} />
      </Box>
      <Box flex="1 1 200px">
        <Text fontSize="xs" color="gray.500" mb={1}>{t("Note")}</Text>
        <Input {...cellInput} placeholder={t("optional")} value={ret.notes}
          onChange={(e) => setRet({ ...ret, notes: e.target.value })} />
      </Box>
      <Button size="sm" colorScheme="teal" onClick={record} isLoading={busy} isDisabled={!ready}>
        {t("Record")}
      </Button>
      {tooMany && (
        <Text fontSize="xs" color="red.600" w="100%">
          {t("Only {n} cases of {lot} are still in the freezer.", { n: picked.inFreezer, lot: picked.parentLotNumber })}
        </Text>
      )}
    </Flex>
  );
};

export default FpReturnForm;
