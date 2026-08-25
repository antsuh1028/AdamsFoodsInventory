import { useState, useRef } from "react";
import {
  Button, Flex, Box, Text, Input, FormControl, FormLabel, SimpleGrid, Spinner, Image, Badge,
  Collapse, useToast, useDisclosure,
} from "@chakra-ui/react";
import { API_BASE_URL } from "../../config/api";
import FloatingWindow from "../FloatingWindow";

const FIELDS = [
  { key: "location",   label: "Location" },
  { key: "lot",        label: "Lot #" },
  { key: "species",    label: "Species" },
  { key: "description",label: "Description" },
  { key: "grade",      label: "Grade" },
  { key: "brand",      label: "Brand" },
  { key: "packdate",   label: "Pack Date",     type: "date" },
  { key: "date_recvd", label: "Date Received", type: "date" },
];

const recalcWeight = (weights) => {
  const total = weights.map((w) => parseFloat(w)).filter((w) => !isNaN(w)).reduce((s, w) => s + w, 0);
  return total > 0 ? total.toFixed(2) : "";
};

const FormScannerReturn = ({ isOpen, onClose, orderId, onSubmit, submitting }) => {
  const [step, setStep] = useState("upload");
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [fields, setFields] = useState({});
  const [individualWeights, setIndividualWeights] = useState([]);
  const [boxesOpen, setBoxesOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState("");
  const [bulkWeight, setBulkWeight] = useState("");
  const { isOpen: isImageOpen, onOpen: onImageOpen, onClose: onImageClose } = useDisclosure();
  const inputRef = useRef(null);
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
      const { individualWeights: iw, scanImageKey: _key, isTally: _t, ...rest } = data;
      setIndividualWeights(iw || []);
      setFields({ ...rest, species: rest.species ? String(rest.species).toUpperCase() : rest.species });
      setStep("review");
    } catch (err) {
      toast({ title: "Extraction failed", description: err.message, status: "error", position: "top", duration: 3000, isClosable: true });
    } finally {
      setExtracting(false);
    }
  };

  const handleManual = () => {
    setFields({});
    setIndividualWeights([]);
    setStep("review");
  };

  const handleSubmit = () => {
    const validBoxes = individualWeights
      .map((w) => ({ weight: String(w) }))
      .filter((b) => b.weight && !isNaN(parseFloat(b.weight)));
    onSubmit(orderId, { ...fields, boxes: validBoxes });
  };

  const setWeight = (index, value) => {
    const updated = [...individualWeights];
    updated[index] = value;
    setIndividualWeights(updated);
    setFields((prev) => ({ ...prev, weight: recalcWeight(updated) }));
  };

  const deleteWeight = (index) => {
    const updated = individualWeights.filter((_, i) => i !== index);
    setIndividualWeights(updated);
    setFields((prev) => ({ ...prev, weight: recalcWeight(updated) }));
  };

  const handleBulkAdd = () => {
    const n = parseInt(bulkCount);
    const w = parseFloat(bulkWeight);
    if (!n || n < 1 || isNaN(w) || w <= 0) return;
    const added = Array(n).fill(String(w));
    const updated = [...individualWeights, ...added];
    setIndividualWeights(updated);
    setFields((prev) => ({ ...prev, weight: recalcWeight(updated) }));
    setBulkCount("");
    setBulkWeight("");
  };

  const handleClose = () => {
    setStep("upload");
    setImagePreview(null);
    setImageFile(null);
    setFields({});
    setIndividualWeights([]);
    setBoxesOpen(false);
    setBulkCount("");
    setBulkWeight("");
    onClose();
  };

  return (
    <>
    <FloatingWindow
      isOpen={isOpen}
      onClose={handleClose}
      width={800}
      title={
        <Flex align="center" gap={2}>
          Return Pallet
          <Badge colorScheme="gray" fontSize="xs">OCR</Badge>
        </Flex>
      }
      bodyProps={{ py: 5, sx: { WebkitOverflowScrolling: "touch", touchAction: "pan-y" } }}
      footer={
        step === "upload" ? (
          <>
            <Button variant="ghost" onClick={handleClose} size="sm">Cancel</Button>
            <Button
              colorScheme="gray"
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
            <Button colorScheme="green" size="sm" onClick={handleSubmit} isLoading={submitting}>
              Add Return
            </Button>
          </>
        )
      }
    >
          {step === "upload" && (
            <Flex direction="column" gap={4} align="center">
              <Box
                border="2px dashed"
                borderColor={imagePreview ? "gray.400" : "gray.200"}
                borderRadius="xl"
                bg={imagePreview ? "gray.50" : "gray.50"}
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
                    <Text fontSize="sm" color="gray.500">Click to upload a photo of the return form</Text>
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
              <Text
                fontSize="xs"
                color="gray.400"
                textDecoration="underline"
                cursor="pointer"
                _hover={{ color: "gray.600" }}
                onClick={handleManual}
              >
                Enter manually instead
              </Text>
            </Flex>
          )}

          {step === "review" && (
            <Flex direction="column" gap={4}>
              {imagePreview && (
                <Flex align="center" gap={3} bg="gray.50" borderRadius={4} p={2} border="1px" borderColor="gray.200">
                  <Image
                    src={imagePreview}
                    h="60px" w="auto"
                    objectFit="contain"
                    borderRadius="md"
                    border="1px solid"
                    borderColor="gray.200"
                    flexShrink={0}
                    cursor="zoom-in"
                    onClick={onImageOpen}
                    title="Click to view full image"
                  />
                  <Text fontSize="xs" color="gray.700" fontWeight="bold">Review and correct the extracted fields before adding the return.</Text>
                </Flex>
              )}

              <SimpleGrid columns={2} spacing={3}>
                {FIELDS.map(({ key, label, type }) => (
                  <FormControl key={key}>
                    <FormLabel fontSize="xs" color="gray.500" mb={1}>{label}</FormLabel>
                    <Input
                      size="sm"
                      borderRadius="lg"
                      type={type || "text"}
                      value={fields[key] || ""}
                      onChange={(e) => setFields((prev) => ({
                        ...prev,
                        [key]: key === "location" || key === "species"
                          ? e.target.value.toUpperCase()
                          : e.target.value,
                      }))}
                      bg={fields[key] ? "white" : "gray.50"}
                      borderColor={fields[key] ? "gray.200" : "gray.300"}
                      autoComplete="off"
                    />
                  </FormControl>
                ))}
              </SimpleGrid>

              {/* Boxes section */}
              <Box bg="gray.50" borderRadius="lg" p={3} border="1px" borderColor="gray.100">
                <Flex align="center" justify="space-between" mb={2}>
                  <Button size="xs" variant="ghost" color="gray.500" onClick={() => setBoxesOpen((v) => !v)}>
                    {boxesOpen ? "Hide" : "Boxes"} ({individualWeights.length})
                    {individualWeights.length > 0 && (
                      <Text as="span" ml={1} color="gray.400">· {recalcWeight(individualWeights)} lb</Text>
                    )}
                  </Button>
                  {boxesOpen && (
                    <Button size="xs" colorScheme="gray" variant="ghost" onClick={() => setIndividualWeights((p) => [...p, ""])}>
                      + Add
                    </Button>
                  )}
                </Flex>

                {/* Bulk add row */}
                <Flex gap={2} align="center" mb={boxesOpen ? 3 : 0}>
                  <Input
                    size="xs"
                    borderRadius="md"
                    placeholder="Count"
                    value={bulkCount}
                    onChange={(e) => setBulkCount(e.target.value)}
                    type="number"
                    w="70px"
                    bg="white"
                  />
                  <Text fontSize="xs" color="gray.400">×</Text>
                  <Input
                    size="xs"
                    borderRadius="md"
                    placeholder="lb each"
                    value={bulkWeight}
                    onChange={(e) => setBulkWeight(e.target.value)}
                    type="number"
                    w="80px"
                    bg="white"
                  />
                  <Button
                    size="xs"
                    colorScheme="gray"
                    onClick={handleBulkAdd}
                    isDisabled={!bulkCount || !bulkWeight}
                  >
                    Bulk Add
                  </Button>
                </Flex>

                <Collapse in={boxesOpen} animateOpacity>
                  <SimpleGrid columns={5} spacing={2}>
                    {individualWeights.map((w, i) => (
                      <Flex key={i} align="center" gap={1}>
                        <Input
                          size="xs"
                          borderRadius="md"
                          value={w}
                          onChange={(e) => setWeight(i, e.target.value)}
                          bg="white"
                          textAlign="center"
                        />
                        <Button size="xs" variant="ghost" colorScheme="red" px={1} minW="auto" onClick={() => deleteWeight(i)}>×</Button>
                      </Flex>
                    ))}
                  </SimpleGrid>
                </Collapse>
              </Box>
            </Flex>
          )}
    </FloatingWindow>

    <FloatingWindow
      isOpen={isImageOpen}
      onClose={onImageClose}
      dark
      width={1024}
      bodyProps={{ p: 3, display: "flex", justifyContent: "center", alignItems: "center" }}
    >
      <Image src={imagePreview} maxH="85vh" maxW="100%" objectFit="contain" borderRadius="md" />
    </FloatingWindow>
    </>
  );
};

export default FormScannerReturn;
