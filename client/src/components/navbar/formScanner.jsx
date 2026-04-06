import { useState, useRef } from "react";
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter,
  Button, Flex, Box, Text, Input, FormControl, FormLabel, SimpleGrid, Spinner, Image, Badge,
  AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogBody, AlertDialogFooter,
  Collapse,
  useToast, useDisclosure,
} from "@chakra-ui/react";
import { WarningTwoIcon } from "@chakra-ui/icons";
import { API_BASE_URL } from "../../config/api";

const FIELDS = [
  { key: "location", label: "Location" },
  { key: "lot", label: "Lot #" },
  { key: "vendor", label: "Vendor" },
  { key: "brand", label: "Brand" },
  { key: "species", label: "Species" },
  { key: "description", label: "Description" },
  { key: "grade", label: "Grade" },
  { key: "quantity", label: "Quantity" },
  { key: "weight", label: "Total Weight (lb)" },
  { key: "date_recvd", label: "Date Received", type: "date" },
  { key: "packdate", label: "Pack Date", type: "date" },
  { key: "est", label: "EST #" },
  { key: "price", label: "Price" },
];

const FormScanner = ({ isOpen, onClose }) => {
  const [step, setStep] = useState("upload"); // upload | review
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fields, setFields] = useState({});
  const [individualWeights, setIndividualWeights] = useState([]);
  const [scanImageKey, setScanImageKey] = useState(null);
  const [isTally, setIsTally] = useState(true);
  const [boxesOpen, setBoxesOpen] = useState(false);
  const [conflictItem, setConflictItem] = useState(null);
  const [resolving, setResolving] = useState(false);
  const { isOpen: isConflictOpen, onOpen: onConflictOpen, onClose: onConflictClose } = useDisclosure();
  const inputRef = useRef(null);
  const cancelConflictRef = useRef(null);
  const toast = useToast();

  const token = localStorage.getItem("token");

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleExtract = async () => {
    if (!imageFile) return;
    // console.log("Uploading file:", imageFile.name, imageFile.type, imageFile.size, "bytes");
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append("image", imageFile);
      const res = await fetch(`${API_BASE_URL}/extract-form`, {
        method: "POST",
        headers: { Authorization: token || "" },
        body: formData,
      });
      if (!res.ok) throw new Error("Extraction failed");
      const data = await res.json();
      const { individualWeights: iw, scanImageKey: key, isTally: tally, ...rest } = data;
      setIndividualWeights(iw || []);
      setScanImageKey(key || null);
      setIsTally(tally !== false);
      setFields(rest);
      setStep("review");
    } catch (err) {
      toast({ title: "Extraction failed", description: err.message, status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setExtracting(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/inventoryAdd`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token || "" },
        body: JSON.stringify({ inputs: { ...fields, scanImageKey, boxes: individualWeights.map((w) => ({ weight: w })) }, force: true }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === "EXACT_DUPLICATE") {
        setConflictItem(data.existingItem);
        onConflictOpen();
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to add item");
      toast({ title: "Item added", status: "success", position: "top", duration: 2000, isClosable: true });
      handleClose();
    } catch (err) {
      toast({ title: "Failed to add", description: err.message, status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (action) => {
    setResolving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/scanner-resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token || "" },
        body: JSON.stringify({ action, existingId: conflictItem._id, inputs: { ...fields, scanImageKey, boxes: individualWeights.map((w) => ({ weight: w })) } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast({ title: action === "update" ? "Item updated" : "Item replaced", status: "success", position: "top", duration: 2000, isClosable: true });
      onConflictClose();
      handleClose();
    } catch (err) {
      toast({ title: "Failed", description: err.message, status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setResolving(false);
    }
  };

  const handleWeightChange = (index, value) => {
    const updated = [...individualWeights];
    updated[index] = value;
    setIndividualWeights(updated);
    const total = updated
      .map((w) => parseFloat(w))
      .filter((w) => !isNaN(w))
      .reduce((sum, w) => sum + w, 0);
    setFields((prev) => ({ ...prev, weight: total.toFixed(2) }));
  };

  const handleWeightAdd = () => {
    setIndividualWeights((prev) => [...prev, ""]);
  };

  const handleWeightDelete = (index) => {
    const updated = individualWeights.filter((_, i) => i !== index);
    setIndividualWeights(updated);
    const total = updated
      .map((w) => parseFloat(w))
      .filter((w) => !isNaN(w))
      .reduce((sum, w) => sum + w, 0);
    setFields((prev) => ({ ...prev, weight: total.toFixed(2) }));
  };

  const handleClose = () => {
    setStep("upload");
    setImagePreview(null);
    setImageFile(null);
    setFields({});
    setIndividualWeights([]);
    setScanImageKey(null);
    setIsTally(true);
    setBoxesOpen(false);
    onClose();
  };

  return (
    <>
    <Modal isOpen={isOpen} onClose={handleClose} size="2xl" scrollBehavior="inside" blockScrollOnMount={false}>
      <ModalOverlay backdropFilter="blur(2px)" />
      <ModalContent borderRadius="xl" sx={{ maxHeight: { base: "85dvh", md: "90dvh" } }} mx={{ base: 2, md: "auto" }}>
        <ModalHeader borderBottom="1px" borderColor="gray.100" py={3} fontSize="md" fontWeight="semibold">
          <Flex align="center" gap={2}>
            Scan Pallet Form
            <Badge colorScheme="blue" fontSize="xs">OCR</Badge>
          </Flex>
        </ModalHeader>
        <ModalCloseButton top={3} />

        <ModalBody py={5} overflowY="auto" sx={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
          {step === "upload" && (
            <Flex direction="column" gap={4} align="center">
              <Box
                border="2px dashed"
                borderColor={imagePreview ? "blue.300" : "gray.200"}
                borderRadius="xl"
                bg={imagePreview ? "blue.50" : "gray.50"}
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
                    <Text fontSize="sm" color="gray.500">Click to upload a photo of the pallet form</Text>
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

          {step === "review" && (
            <Flex direction="column" gap={4}>
              {!isTally && (
                <Flex align="center" gap={2} bg="orange.50" border="1px solid" borderColor="orange.200" borderRadius="lg" px={3} py={2}>
                  <WarningTwoIcon color="orange.400" boxSize={4} flexShrink={0} />
                  <Text fontSize="xs" color="orange.700" fontWeight="medium">
                    This image doesn't look like an Adams Foods tally form. Fields may be inaccurate.
                  </Text>
                </Flex>
              )}
              <Flex align="center" gap={3} bg="gray.100" borderRadius={4}>
                {imagePreview && (
                  <Image src={imagePreview} h="60px" w="auto" objectFit="contain" borderRadius="md" border="1px solid" borderColor="gray.200" flexShrink={0} />
                )}
                <Text fontSize="xs" color="gray.500" fontWeight="bold">Review and correct the extracted fields before adding to inventory.</Text>
              </Flex>
              <SimpleGrid columns={2} spacing={3}>
                {FIELDS.map(({ key, label, type }) => (
                  <FormControl key={key}>
                    <FormLabel fontSize="xs" color="gray.500" mb={1}>{label}</FormLabel>
                    <Input
                      size="sm"
                      borderRadius="lg"
                      type={type || "text"}
                      value={fields[key] || ""}
                      onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
                      bg={fields[key] ? "white" : "yellow.50"}
                      borderColor={fields[key] ? "gray.200" : "yellow.300"}
                    />
                  </FormControl>
                ))}
              </SimpleGrid>
              <Box bg="gray.50" borderRadius="lg" p={3}>
                  <Flex align="center" justify="space-between">
                    <Button
                      size="xs"
                      variant="ghost"
                      color="gray.500"
                      onClick={() => setBoxesOpen((v) => !v)}
                    >
                      {boxesOpen ? "Hide" : "Boxes"} ({individualWeights.length})
                    </Button>
                    {boxesOpen && (
                      <Button size="xs" colorScheme="blue" variant="ghost" onClick={handleWeightAdd}>
                        + Add
                      </Button>
                    )}
                  </Flex>
                  <Collapse in={boxesOpen} animateOpacity>
                    <Box mt={2}>
                      <Text fontSize="xs" color="gray.400" mb={2}>
                        Edit or remove to recalculate total weight
                      </Text>
                      <SimpleGrid columns={5} spacing={2}>
                        {individualWeights.map((w, i) => (
                          <Flex key={i} align="center" gap={1}>
                            <Input
                              size="xs"
                              borderRadius="md"
                              value={w}
                              onChange={(e) => handleWeightChange(i, e.target.value)}
                              bg="white"
                              textAlign="center"
                            />
                            <Button
                              size="xs"
                              variant="ghost"
                              colorScheme="red"
                              px={1}
                              minW="auto"
                              onClick={() => handleWeightDelete(i)}
                            >
                              ×
                            </Button>
                          </Flex>
                        ))}
                      </SimpleGrid>
                    </Box>
                  </Collapse>
                </Box>
            </Flex>
          )}
        </ModalBody>

        <ModalFooter borderTop="1px" borderColor="gray.100" gap={2}>
          {step === "upload" ? (
            <>
              <Button variant="ghost" onClick={handleClose} size="sm">Cancel</Button>
              <Button
                colorScheme="blue"
                size="sm"
                onClick={handleExtract}
                isDisabled={!imageFile || extracting}
                leftIcon={extracting ? <Spinner size="xs" /> : undefined}
              >
                {extracting ? "Extracting..." : "Extract Fields"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep("upload")}>Back</Button>
              <Button
                colorScheme="green"
                size="sm"
                onClick={handleSubmit}
                isLoading={submitting}
              >
                Add to Inventory
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>

    <AlertDialog isOpen={isConflictOpen} leastDestructiveRef={cancelConflictRef} onClose={onConflictClose} isCentered>
      <AlertDialogOverlay backdropFilter="blur(2px)" />
      <AlertDialogContent borderRadius="xl" maxW="400px">
        <Box px={6} pt={5} pb={3} borderBottom="1px" borderColor="gray.100">
          <Text fontWeight="bold" fontSize="md" color="gray.800">Lot Already Exists</Text>
          <Text fontSize="xs" color="gray.400" mt={0.5}>
            Lot {conflictItem?.lot} is already at {conflictItem?.location}
          </Text>
        </Box>
        <AlertDialogBody px={6} py={4}>
          <Text fontSize="sm" color="gray.600" mb={3}>How would you like to proceed?</Text>
          <Flex direction="column" gap={2}>
            <Box p={3} borderRadius="lg" border="1px" borderColor="blue.100" bg="blue.50">
              <Text fontSize="sm" fontWeight="semibold" color="blue.700">Update</Text>
              <Text fontSize="xs" color="blue.600">Merge scanned fields into the existing item. Use this if it's the same pallet with new data.</Text>
            </Box>
            <Box p={3} borderRadius="lg" border="1px" borderColor="red.100" bg="red.50">
              <Text fontSize="sm" fontWeight="semibold" color="red.700">Override</Text>
              <Text fontSize="xs" color="red.600">Remove the existing item and add this as a new one. Use this if the old pallet left and a new one arrived.</Text>
            </Box>
          </Flex>
        </AlertDialogBody>
        <AlertDialogFooter px={6} pb={5} gap={2}>
          <Button ref={cancelConflictRef} variant="outline" borderRadius="lg" size="sm" onClick={onConflictClose} isDisabled={resolving}>
            Cancel
          </Button>
          <Button colorScheme="blue" borderRadius="lg" size="sm" onClick={() => handleResolve("update")} isLoading={resolving}>
            Update
          </Button>
          <Button colorScheme="red" borderRadius="lg" size="sm" onClick={() => handleResolve("override")} isLoading={resolving}>
            Override
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};

export default FormScanner;
