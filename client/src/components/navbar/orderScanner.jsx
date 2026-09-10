import { useState, useRef } from "react";
import {
  Button, Flex, Box, Text, Image, Badge, Spinner, Checkbox, Input,
  AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogBody, AlertDialogFooter,
  useToast, useDisclosure,
} from "@chakra-ui/react";
import { WarningIcon, CheckCircleIcon, InfoIcon } from "@chakra-ui/icons";
import { API_BASE_URL } from "../../config/api";
import axiosInstance from "../../utils/axiosInstance";
import FloatingWindow from "../FloatingWindow";

const OrderScanner = ({ isOpen, onClose }) => {
  const [step, setStep] = useState("upload");
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [items, setItems] = useState([]);
  const inputRef = useRef(null);
  const cancelRef = useRef(null);
  const toast = useToast();
  const { isOpen: isImageOpen, onOpen: onImageOpen, onClose: onImageClose } = useDisclosure();
  const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose } = useDisclosure();

  const token = localStorage.getItem("token");

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleExtract = async () => {
    if (!imageFile) return;
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      const res = await fetch(`${API_BASE_URL}/extract-order`, {
        method: "POST",
        headers: { Authorization: token || "" },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Extraction failed");
      }
      const data = await res.json();
      const enriched = data.items.map((item) => ({
        ...item,
        checked: item.matches.length === 1,
        selectedId: item.matches.length === 1 ? item.matches[0]._id : null,
      }));
      setItems(enriched);
      setStep("review");
    } catch (err) {
      toast({ title: "Extraction failed", description: err.message, status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setExtracting(false);
    }
  };

  const toggleCheck = (i) => {
    setItems((prev) => prev.map((item, idx) => idx === i ? { ...item, checked: !item.checked } : item));
  };

  const selectMatch = (i, id) => {
    setItems((prev) => prev.map((item, idx) => idx === i ? { ...item, selectedId: id, checked: true } : item));
  };

  const updateItem = (i, field, val) => {
    setItems((prev) => prev.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  };

  const toRemove = items.filter((item) => item.checked && item.selectedId);

  const handleConfirmRemove = async () => {
    onConfirmClose();
    setRemoving(true);
    try {
      const removals = toRemove.map((item) => ({
        id: item.selectedId,
        quantityToRemove: parseInt(item.quantity) || 1,
      }));
      await axiosInstance.post("/inventoryOrderRemove", { removals });
      toast({
        title: `${removals.length} item${removals.length !== 1 ? "s" : ""} updated`,
        status: "success",
        position: "top",
        duration: 2500,
        isClosable: true,
      });
      handleClose();
    } catch {
      toast({ title: "Removal failed", status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setRemoving(false);
    }
  };

  const handleClose = () => {
    setStep("upload");
    setImagePreview(null);
    setImageFile(null);
    setItems([]);
    onClose();
  };

  const statusIcon = (item) => {
    if (item.matches.length === 0) return <WarningIcon color="yellow.600" boxSize={3} />;
    if (item.matches.length === 1) return <CheckCircleIcon color="green.400" boxSize={3} />;
    return <InfoIcon color="blue.400" boxSize={3} />;
  };

  return (
    <>
      <FloatingWindow
        isOpen={isOpen}
        onClose={handleClose}
        width={800}
        title={
          <Flex align="center" gap={2} flexWrap="wrap">
            Scan Order Sheet
            <Badge colorScheme="red" fontSize="xs">Bulk Remove</Badge>
            <Badge colorScheme="blue" fontSize="xs">OCR</Badge>
          </Flex>
        }
        bodyProps={{ py: 4, px: { base: 3, md: 5 }, sx: { WebkitOverflowScrolling: "touch", touchAction: "pan-y" } }}
        footer={step === "upload" ? (
          <>
            <Button variant="ghost" onClick={handleClose} size="sm">Cancel</Button>
            <Button
              colorScheme="red"
              size="sm"
              onClick={handleExtract}
              isDisabled={!imageFile || extracting}
              leftIcon={extracting ? <Spinner size="xs" /> : undefined}
            >
              {extracting ? "Extracting..." : "Extract Order"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => setStep("upload")}>Back</Button>
            <Text fontSize="xs" color="gray.400" flex={1}>
              {toRemove.length} selected
            </Text>
            <Button
              colorScheme="red"
              size="sm"
              onClick={onConfirmOpen}
              isDisabled={toRemove.length === 0}
              isLoading={removing}
            >
              Remove {toRemove.length > 0 ? toRemove.length : ""} from Inventory
            </Button>
          </>
        )}
      >
            {/* ── Upload step ── */}
            {step === "upload" && (
              <Flex direction="column" gap={4} align="center">
                <Box
                  border="2px dashed"
                  borderColor={imagePreview ? "red.300" : "gray.200"}
                  borderRadius="xl"
                  bg={imagePreview ? "red.50" : "gray.50"}
                  w="100%"
                  minH="200px"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  cursor="pointer"
                  onClick={() => inputRef.current?.click()}
                  overflow="hidden"
                >
                  {imagePreview ? (
                    <Image src={imagePreview} maxH="400px" objectFit="contain" />
                  ) : (
                    <Flex direction="column" align="center" gap={2} p={8}>
                      <Text fontSize="sm" color="gray.500">Tap to upload a photo of the order sheet</Text>
                      <Text fontSize="xs" color="gray.400">JPG, PNG, HEIC supported</Text>
                    </Flex>
                  )}
                </Box>
                <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/jpg,image/heic,image/heif" style={{ display: "none" }} onChange={handleFileChange} />
                {imagePreview && (
                  <Button variant="ghost" size="sm" colorScheme="gray" onClick={() => { setImagePreview(null); setImageFile(null); }}>
                    Remove
                  </Button>
                )}
              </Flex>
            )}

            {/* ── Review step ── */}
            {step === "review" && (
              <Flex direction="column" gap={3}>
                {/* Summary bar */}
                <Flex align="center" gap={3} bg="gray.50" borderRadius="lg" p={3}>
                  {imagePreview && (
                    <Image
                      src={imagePreview}
                      h="48px"
                      w="auto"
                      objectFit="contain"
                      borderRadius="md"
                      border="1px solid"
                      borderColor="gray.200"
                      flexShrink={0}
                      cursor="zoom-in"
                      onClick={onImageOpen}
                    />
                  )}
                  <Box>
                    <Text fontSize="xs" color="gray.600" fontWeight="semibold">
                      {items.length} line item{items.length !== 1 ? "s" : ""} — check to remove
                    </Text>
                    <Flex gap={3} mt={0.5} flexWrap="wrap">
                      <Text fontSize="xs" color="green.600">✓ {items.filter((i) => i.matches.length === 1).length} matched</Text>
                      {items.filter((i) => i.matches.length > 1).length > 0 && (
                        <Text fontSize="xs" color="blue.600">⚠ {items.filter((i) => i.matches.length > 1).length} pick needed</Text>
                      )}
                      {items.filter((i) => i.matches.length === 0).length > 0 && (
                        <Text fontSize="xs" color="yellow.600">✗ {items.filter((i) => i.matches.length === 0).length} not found</Text>
                      )}
                    </Flex>
                  </Box>
                </Flex>

                {/* Cards */}
                <Flex direction="column" gap={2}>
                  {items.map((item, i) => {
                    const match = item.matches.find((m) => m._id === item.selectedId) || item.matches[0];
                    const inStock = parseInt(match?.quantity) || 0;
                    const taking = parseInt(item.quantity) || 0;
                    const after = Math.max(0, inStock - taking);
                    const isChecked = item.checked && !!item.selectedId;

                    return (
                      <Box
                        key={i}
                        border="1px"
                        borderColor={isChecked ? "red.200" : "gray.100"}
                        borderRadius="lg"
                        bg={isChecked ? "red.50" : "white"}
                        p={3}
                        opacity={item.matches.length === 0 ? 0.55 : 1}
                      >
                        {/* Top row: checkbox + editable lot + status + editable qty */}
                        <Flex align="center" gap={2} mb={2}>
                          <Checkbox
                            isChecked={isChecked}
                            isDisabled={item.matches.length === 0 || !item.selectedId}
                            onChange={() => toggleCheck(i)}
                            colorScheme="red"
                            flexShrink={0}
                          />
                          {statusIcon(item)}
                          <Input
                            size="xs"
                            value={item.lot}
                            onChange={(e) => updateItem(i, "lot", e.target.value)}
                            fontFamily="mono"
                            fontWeight="bold"
                            flex={1}
                            placeholder="Lot #"
                            borderColor={isChecked ? "red.200" : "gray.200"}
                          />
                          <Flex align="center" gap={1} flexShrink={0}>
                            <Input
                              size="xs"
                              value={item.quantity}
                              onChange={(e) => updateItem(i, "quantity", e.target.value)}
                              w="44px"
                              textAlign="center"
                              placeholder="Qty"
                            />
                            <Text fontSize="xs" color="gray.400">bx</Text>
                          </Flex>
                        </Flex>

                        {/* Editable description */}
                        <Input
                          size="xs"
                          value={item.description || ""}
                          onChange={(e) => updateItem(i, "description", e.target.value)}
                          placeholder="Description"
                          mb={1.5}
                          ml={6}
                          w="calc(100% - 1.5rem)"
                          color="gray.600"
                        />

                        {/* Editable brand / packdate / location */}
                        <Flex ml={6} gap={1.5} mb={1.5} flexWrap="wrap">
                          <Input
                            size="xs"
                            value={item.brand || ""}
                            onChange={(e) => updateItem(i, "brand", e.target.value)}
                            placeholder="Brand"
                            w="80px"
                          />
                          <Input
                            size="xs"
                            type="date"
                            value={item.packdate || ""}
                            onChange={(e) => updateItem(i, "packdate", e.target.value)}
                            w="130px"
                          />
                          <Input
                            size="xs"
                            value={item.location || ""}
                            onChange={(e) => updateItem(i, "location", e.target.value)}
                            placeholder="Loc"
                            w="60px"
                            textTransform="uppercase"
                          />
                        </Flex>

                        {/* Match info */}
                        {item.matches.length === 0 && (
                          <Box pl={6}>
                            <Text fontSize="xs" color="yellow.600">Not found in inventory</Text>
                          </Box>
                        )}

                        {item.matches.length === 1 && (
                          <Flex pl={6} align="center" justify="space-between" flexWrap="wrap" gap={1}>
                            <Text fontSize="xs" color="gray.700" noOfLines={1} flex={1}>
                              {item.matches[0].description}
                            </Text>
                            <Flex align="center" gap={2} flexShrink={0}>
                              <Text fontSize="xs" fontFamily="mono" color="blue.600">{item.matches[0].location}</Text>
                              <Text fontSize="xs" color="gray.400">
                                {inStock} → <Text as="span" fontWeight="bold" color={after === 0 ? "red.500" : "green.600"}>{after}</Text>
                              </Text>
                            </Flex>
                          </Flex>
                        )}

                        {item.matches.length > 1 && (
                          <Box pl={6}>
                            <Text fontSize="xs" color="blue.500" mb={1}>Multiple matches — tap to select:</Text>
                            <Flex direction="column" gap={1}>
                              {item.matches.map((m) => (
                                <Flex
                                  key={m._id}
                                  px={2}
                                  py={1.5}
                                  borderRadius="md"
                                  border="1px"
                                  borderColor={item.selectedId === m._id ? "blue.400" : "gray.200"}
                                  bg={item.selectedId === m._id ? "blue.50" : "white"}
                                  cursor="pointer"
                                  onClick={() => selectMatch(i, m._id)}
                                  align="center"
                                  justify="space-between"
                                >
                                  <Text fontSize="xs" fontWeight={item.selectedId === m._id ? "semibold" : "normal"} noOfLines={1}>
                                    {m.description}
                                  </Text>
                                  <Text fontSize="xs" fontFamily="mono" color="blue.500" ml={2} flexShrink={0}>{m.location}</Text>
                                </Flex>
                              ))}
                            </Flex>
                          </Box>
                        )}
                      </Box>
                    );
                  })}
                </Flex>
              </Flex>
            )}
      </FloatingWindow>

      {/* Full image preview */}
      <FloatingWindow
        isOpen={isImageOpen}
        onClose={onImageClose}
        width={1024}
        dark
        bodyProps={{ p: 3, display: "flex", justifyContent: "center", alignItems: "center" }}
      >
        <Image src={imagePreview} maxH="85vh" maxW="100%" objectFit="contain" borderRadius="md" />
      </FloatingWindow>

      {/* Confirm removal */}
      <AlertDialog isOpen={isConfirmOpen} leastDestructiveRef={cancelRef} onClose={onConfirmClose} isCentered>
        <AlertDialogOverlay backdropFilter="blur(2px)" />
        <AlertDialogContent borderRadius="xl" mx={3}>
          <Box px={6} pt={5} pb={3} borderBottom="1px" borderColor="gray.100">
            <Text fontWeight="bold" fontSize="md" color="gray.800">Confirm Removal</Text>
            <Text fontSize="xs" color="gray.400" mt={0.5}>This action cannot be undone</Text>
          </Box>
          <AlertDialogBody px={6} py={4}>
            <Flex direction="column" gap={2} maxH="260px" overflowY="auto">
              {toRemove.map((item, i) => {
                const match = item.matches.find((m) => m._id === item.selectedId);
                const inStock = parseInt(match?.quantity) || 0;
                const taking = parseInt(item.quantity) || 0;
                const after = Math.max(0, inStock - taking);
                return (
                  <Flex key={i} justify="space-between" align="flex-start" py={1.5} borderBottom="1px" borderColor="gray.100" gap={2}>
                    <Box flex={1} minW={0}>
                      <Text fontSize="xs" fontFamily="mono" color="gray.400">{item.lot}</Text>
                      <Text fontSize="sm" fontWeight="medium" color="gray.800" noOfLines={1}>{match?.description}</Text>
                      <Text fontSize="xs" color="gray.500">
                        {taking} box{taking !== 1 ? "es" : ""} removed — {after} remaining{after === 0 ? " (deleted)" : ""}
                      </Text>
                    </Box>
                    <Text fontSize="xs" fontFamily="mono" color="blue.500" flexShrink={0}>{match?.location}</Text>
                  </Flex>
                );
              })}
            </Flex>
          </AlertDialogBody>
          <AlertDialogFooter px={6} pb={5} gap={3}>
            <Button ref={cancelRef} onClick={onConfirmClose} variant="outline" borderRadius="lg" w="full">Cancel</Button>
            <Button colorScheme="red" borderRadius="lg" w="full" onClick={handleConfirmRemove}>
              Remove {toRemove.length} Item{toRemove.length !== 1 ? "s" : ""}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default OrderScanner;
