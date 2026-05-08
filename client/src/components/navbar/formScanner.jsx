import { useState, useRef, useContext, useEffect } from "react";
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter,
  Button, Flex, Box, Text, Input, Select, FormControl, FormLabel, SimpleGrid, Spinner, Image, Badge,
  InputGroup, InputRightElement,
  Collapse,
  useToast, useDisclosure,
} from "@chakra-ui/react";
import { WarningTwoIcon } from "@chakra-ui/icons";
import { API_BASE_URL } from "../../config/api";
import { FormContext } from "../../utils/homescreen/formContext";
import { AutocompleteInput } from "../homescreen/formFields";

const FIELDS = [
  { key: "location", label: "Location" },
  { key: "lot", label: "Lot #" },
  { key: "vendor", label: "Vendor/Brand" },
  { key: "brand", label: "Brand" },
  { key: "species", label: "Species" },
  { key: "description", label: "Description" },
  { key: "grade", label: "Grade" },
  { key: "type", label: "Type", type: "select", options: [{ value: "", label: "—" }, { value: "raw", label: "Raw" }, { value: "prc", label: "Processed" }] },
  { key: "quantity", label: "Quantity" },
  { key: "weight", label: "Total Weight (lb)" },
  { key: "date_recvd", label: "Date Received", type: "date" },
  { key: "packdate", label: "Pack Date", type: "date" },
  { key: "est", label: "EST #" },
  { key: "price", label: "Price" },
];

const classifyType = (brand = "", description = "") => {
  const b = brand.toLowerCase();
  const d = description.toLowerCase();
  if (b.includes("shabuya") || b.includes("pho gyu")) return "prc";
  if (b.includes("creekstone")) return "raw";
  if (/\b\d{5,}\b/.test(d)) return "prc";
  return "";
};

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
  const { isOpen: isImageOpen, onOpen: onImageOpen, onClose: onImageClose } = useDisclosure();
  const inputRef = useRef(null);
  const toast = useToast();

  const { onScannerAdd, suggestions } = useContext(FormContext);
  const token = localStorage.getItem("token");
  const [badgeState, setBadgeState] = useState(null);

  useEffect(() => {
    const loc = fields.location;
    if (!loc) { setBadgeState(null); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const verifyRes = await fetch(`${API_BASE_URL}/verifyLocation`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: token || "" },
          body: JSON.stringify({ location: loc }),
          signal: controller.signal,
        });
        const verifyData = await verifyRes.text();
        if (verifyData !== "OK") { setBadgeState("error"); return; }
        const findRes = await fetch(`${API_BASE_URL}/inventoryFind`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: token || "" },
          body: JSON.stringify({ inputs: { location: loc } }),
          signal: controller.signal,
        });
        const findData = await findRes.json();
        setBadgeState(findData === "INVALID" ? "out" : "in");
      } catch (err) {
        if (err.name !== "AbortError") setBadgeState("error");
      }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [fields.location, token]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setFields({ ...rest, species: rest.species ? String(rest.species).toUpperCase() : rest.species, type: rest.type || classifyType(rest.brand, rest.description) });
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
        body: JSON.stringify({ inputs: { ...fields, scanImageKey, boxes: individualWeights.map((w) => ({ weight: w })) }, force: true, source: "scanner" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add item");
      toast({ title: "Item added", status: "success", position: "top", duration: 2000, isClosable: true });
      onScannerAdd(fields.location);
      handleClose();
    } catch (err) {
      toast({ title: "Failed to add", description: err.message, status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setSubmitting(false);
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
    setBadgeState(null);
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
                  <Image
                    src={imagePreview}
                    h="60px"
                    w="auto"
                    objectFit="contain"
                    borderRadius="md"
                    border="1px solid"
                    borderColor="gray.200"
                    flexShrink={0}
                    cursor="zoom-in"
                    onClick={onImageOpen}
                    title="Click to view full image"
                  />
                )}
                <Text fontSize="xs" color="gray.500" fontWeight="bold">Review and correct the extracted fields before adding to inventory.</Text>
              </Flex>
              <SimpleGrid columns={2} spacing={3}>
                {FIELDS.map(({ key, label, type, options }) => (
                  <FormControl key={key}>
                    <FormLabel fontSize="xs" color="gray.500" mb={1}>{label}</FormLabel>
                    {type === "select" ? (
                      <Select
                        size="sm"
                        borderRadius="lg"
                        value={fields[key] || ""}
                        onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
                        bg={fields[key] ? "white" : "yellow.50"}
                        borderColor={fields[key] ? "gray.200" : "yellow.300"}
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </Select>
                    ) : key === "location" ? (
                      <InputGroup size="sm">
                        <Input
                          size="sm"
                          borderRadius="lg"
                          value={fields.location || ""}
                          onChange={(e) => setFields((prev) => ({ ...prev, location: e.target.value.toUpperCase() }))}
                          bg={fields.location ? "white" : "yellow.50"}
                          borderColor={fields.location ? "gray.200" : "yellow.300"}
                          autoComplete="off"
                        />
                        <InputRightElement width="auto" mr={1}>
                          {badgeState === "in"  && <Badge colorScheme="gray"  p="1" fontSize="10px">Occupied</Badge>}
                          {badgeState === "out" && <Badge colorScheme="green" p="1" fontSize="10px">Empty</Badge>}
                          {badgeState === "error" && <Badge colorScheme="red" p="1" fontSize="10px">Invalid</Badge>}
                        </InputRightElement>
                      </InputGroup>
                    ) : (key === "vendor" || key === "brand") ? (
                      <AutocompleteInput
                        value={fields[key] || ""}
                        suggestions={key === "vendor" ? (suggestions?.vendors ?? []) : (suggestions?.brands ?? [])}
                        onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
                        inputSize="sm"
                        bg={fields[key] ? "white" : "yellow.50"}
                        placeholder=""
                        type="text"
                      />
                    ) : (
                      <Input
                        size="sm"
                        borderRadius="lg"
                        type={type || "text"}
                        value={fields[key] || ""}
                        onChange={(e) => setFields((prev) => ({ ...prev, [key]: key === "species" ? e.target.value.toUpperCase() : e.target.value }))}
                        bg={fields[key] ? "white" : "yellow.50"}
                        borderColor={fields[key] ? "gray.200" : "yellow.300"}
                      />
                    )}
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

    <Modal isOpen={isImageOpen} onClose={onImageClose} size="4xl" isCentered>
      <ModalOverlay backdropFilter="blur(2px)" />
      <ModalContent borderRadius="xl" bg="gray.900">
        <ModalCloseButton color="white" />
        <ModalBody p={3} display="flex" justifyContent="center" alignItems="center">
          <Image src={imagePreview} maxH="85vh" maxW="100%" objectFit="contain" borderRadius="md" />
        </ModalBody>
      </ModalContent>
    </Modal>

    </>
  );
};

export default FormScanner;
