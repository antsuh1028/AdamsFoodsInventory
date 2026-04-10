import { useState } from "react";
import {
  Box,
  Text,
  Flex,
  Button,
  Divider,
  Collapse,
  Grid,
  GridItem,
  Input,
  Select,
  Badge,
  useToast,
} from "@chakra-ui/react";
import printDetails from "../../utils/printDetails";
import { API_BASE_URL } from "../../config/api";

// Fields that can be inline-edited (weight/quantity are auto, location has its own move flow)
const EDITABLE_FIELDS = [
  "lot",
  "vendor",
  "brand",
  "species",
  "description",
  "grade",
  "type",
  "packdate",
  "date_recvd",
  "est",
  "price",
];

const species = ["BEEF", "PORK", "CHICKEN", "LAMB", "OTHER"];

const EditableField = ({ label, value, fieldKey, onStage }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");


  const startEdit = () => {
    if (!EDITABLE_FIELDS.includes(fieldKey)) return;
    setDraft(value || "");
    setEditing(true);
  };

  const commit = () => {
    const processedDraft = fieldKey === "species" ? draft.toUpperCase() : draft;
    if (processedDraft !== (value || "") && (fieldKey !== "species" || species.includes(processedDraft))) onStage(fieldKey, label, value || "", processedDraft);
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <GridItem>
        <Text
          fontSize="xs"
          color="gray.400"
          fontWeight="medium"
          textTransform="uppercase"
          letterSpacing="wide"
          mb={1}
        >
          {label}
        </Text>
        {fieldKey === "type" ? (
          <Select size="xs" value={draft} autoFocus borderRadius="md" onChange={(e) => setDraft(e.target.value)} onBlur={commit}>
            <option value="">—</option>
            <option value="raw">Raw</option>
            <option value="prc">Processed</option>
          </Select>
        ) : (
          <Input
            size="xs"
            value={draft}
            autoFocus
            borderRadius="md"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") cancel();
            }}
            onBlur={commit}
          />
        )}
      </GridItem>
    );
  }

  const isEditable = EDITABLE_FIELDS.includes(fieldKey);
  return (
    <GridItem>
      <Text
        fontSize="xs"
        color="gray.400"
        fontWeight="medium"
        textTransform="uppercase"
        letterSpacing="wide"
      >
        {label}
      </Text>
      {fieldKey === "type" ? (
        <Badge
          colorScheme={value === "raw" ? "green" : value === "prc" ? "purple" : "gray"}
          fontSize="xs"
          cursor={isEditable ? "pointer" : "default"}
          onDoubleClick={isEditable ? startEdit : undefined}
          title={isEditable ? "Double-click to edit" : undefined}
        >
          {value === "raw" ? "Raw" : value === "prc" ? "Processed" : "—"}
        </Badge>
      ) : (
        <Text
          fontSize="sm"
          color={value ? "gray.700" : "gray.300"}
          fontWeight="medium"
          cursor={isEditable ? "text" : "default"}
          title={isEditable ? "Double-click to edit" : undefined}
          onDoubleClick={isEditable ? startEdit : undefined}
          _hover={isEditable ? { color: "blue.500" } : undefined}
          transition="color 0.1s"
        >
          {value || "—"}
        </Text>
      )}
    </GridItem>
  );
};

const DetailsPanel = ({
  item,
  showDetails,
  onClose,
  onSet,
  onLocate,
  onItemUpdate,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [addingBox, setAddingBox] = useState(false);
  const [newBoxWeight, setNewBoxWeight] = useState("");
  const [boxLoading, setBoxLoading] = useState(null);
  const [boxesExpanded, setBoxesExpanded] = useState(false);
  const [lastRemovedBox, setLastRemovedBox] = useState(null);
  const [pendingEdit, setPendingEdit] = useState(null); // { field, label, oldValue, newValue }
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const token = localStorage.getItem("token");

  const authPatch = (url, body) =>
    fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: token || "",
      },
      body: JSON.stringify(body),
    });

  const handleStage = (field, label, oldValue, newValue) => {
    if (newValue.trim() === oldValue.trim()) return;
    setPendingEdit({ field, label, oldValue, newValue });
  };

  const handleConfirmEdit = async () => {
    if (!pendingEdit) return;
    setSaving(true);
    try {
      const res = await authPatch(
        `${API_BASE_URL}/inventory/${item._id}/field`,
        { field: pendingEdit.field, value: pendingEdit.newValue },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      onItemUpdate(data);
      setPendingEdit(null);
    } catch (err) {
      toast({
        title: "Failed to update",
        description: err.message,
        status: "error",
        position: "top",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveBox = async (index) => {
    setBoxLoading(index);
    try {
      const removedWeight = item.boxes[index].weight;
      const res = await authPatch(
        `${API_BASE_URL}/inventory/${item._id}/box/remove`,
        { index },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      onItemUpdate(data);
      setLastRemovedBox({ weight: removedWeight });
    } catch (err) {
      toast({
        title: "Failed to remove box",
        description: err.message,
        status: "error",
        position: "top",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setBoxLoading(null);
    }
  };

  const handleUndoRemove = async () => {
    if (!lastRemovedBox) return;
    setBoxLoading("add");
    try {
      const res = await authPatch(
        `${API_BASE_URL}/inventory/${item._id}/box/add`,
        { weight: lastRemovedBox.weight },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      onItemUpdate(data);
      setLastRemovedBox(null);
    } catch (err) {
      toast({
        title: "Failed to undo",
        description: err.message,
        status: "error",
        position: "top",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setBoxLoading(null);
    }
  };

  const handleAddBox = async () => {
    const w = parseFloat(newBoxWeight);
    if (isNaN(w) || w <= 0) {
      toast({
        title: "Enter a valid weight",
        status: "warning",
        position: "top",
        duration: 2000,
        isClosable: true,
      });
      return;
    }
    setBoxLoading("add");
    try {
      const res = await authPatch(
        `${API_BASE_URL}/inventory/${item._id}/box/add`,
        { weight: newBoxWeight },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      onItemUpdate(data);
      setNewBoxWeight("");
      setAddingBox(false);
    } catch (err) {
      toast({
        title: "Failed to add box",
        description: err.message,
        status: "error",
        position: "top",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setBoxLoading(null);
    }
  };

  const itemBoxes = item?.boxes ?? [];

  return (
    <Collapse
      in={showDetails && !!item}
      animateOpacity
      onAnimationComplete={() => {
        if (!showDetails) setExpanded(false);
      }}
    >
      <Box
        borderTop="2px"
        borderColor="blue.100"
        bg="white"
        px={4}
        pt={3}
        pb={4}
      >
        <Flex justify="space-between" align="flex-start" mb={2}>
          <Box>
            <Text fontWeight="bold" fontSize="sm" color="gray.800">
              {item?.location}
            </Text>
            {/* <Text fontSize="xs" color="gray.500" noOfLines={1}>
              {item?.description}
            </Text> */}
            <EditableField
            // label="Description"
            value={item?.description}
            fieldKey="description"
            onStage={handleStage}
          />
          </Box>
          <Button
            size="xs"
            variant="ghost"
            color="gray.400"
            _hover={{ color: "gray.700" }}
            onClick={onClose}
            minW="auto"
            p={1}
          >
            ✕
          </Button>
        </Flex>

        <Divider mb={3} />

        {/* Pending edit confirmation bar */}
        {pendingEdit && (
          <Flex
            align="center"
            gap={2}
            mb={3}
            px={3}
            py={2}
            bg="blue.50"
            borderRadius="md"
            border="1px"
            borderColor="blue.200"
          >
            <Text fontSize="xs" color="blue.700" flex={1} noOfLines={1}>
              Set <b>{pendingEdit.label}</b> to "{pendingEdit.newValue}"?
            </Text>
            <Button
              size="xs"
              colorScheme="blue"
              borderRadius="md"
              isLoading={saving}
              onClick={handleConfirmEdit}
            >
              Confirm
            </Button>
            <Button
              size="xs"
              variant="ghost"
              colorScheme="gray"
              onClick={() => setPendingEdit(null)}
            >
              ✕
            </Button>
          </Flex>
        )}

        {/* Summary row — always visible */}
        <Grid templateColumns="repeat(3, 1fr)" gap={3} mb={3}>
          <EditableField
            label="Lot"
            value={item?.lot}
            fieldKey="lot"
            onStage={handleStage}
          />
          <EditableField
            label="Brand"
            value={item?.brand}
            fieldKey="brand"
            onStage={handleStage}
          />
          <EditableField
            label="Grade"
            value={item?.grade}
            fieldKey="grade"
            onStage={handleStage}
          />
          <GridItem>
            <Text
              fontSize="xs"
              color="gray.400"
              fontWeight="medium"
              textTransform="uppercase"
              letterSpacing="wide"
            >
              Quantity
            </Text>
            <Text
              fontSize="sm"
              color={item?.quantity ? "gray.700" : "gray.300"}
              fontWeight="medium"
            >
              {item?.quantity ? `${item.quantity} bx` : "—"}
            </Text>
          </GridItem>
          <GridItem>
            <Text
              fontSize="xs"
              color="gray.400"
              fontWeight="medium"
              textTransform="uppercase"
              letterSpacing="wide"
            >
              Weight
            </Text>
            <Text
              fontSize="sm"
              color={item?.weight ? "gray.700" : "gray.300"}
              fontWeight="medium"
            >
              {item?.weight ? `${item.weight} lb` : "—"}
            </Text>
          </GridItem>
          <EditableField
            label="Species"
            value={item?.species}
            fieldKey="species"
            onStage={handleStage}
          />
          <EditableField
            label="Price / lb"
            value={item?.price ? `$${item.price}` : null}
            fieldKey="price"
            onStage={handleStage}
          />
          <EditableField
            label="Type"
            value={item?.type}
            fieldKey="type"
            onStage={handleStage}
          />
        </Grid>

        {/* Expanded details */}
        <Collapse in={expanded} animateOpacity>
          <Divider mb={3} />
          <Grid templateColumns="repeat(3, 1fr)" gap={3} mb={3}>
            <EditableField
              label="Vendor"
              value={item?.vendor}
              fieldKey="vendor"
              onStage={handleStage}
            />
            <EditableField
              label="EST #"
              value={item?.est}
              fieldKey="est"
              onStage={handleStage}
            />
            <EditableField
              label="Pack Date"
              value={item?.packdate}
              fieldKey="packdate"
              onStage={handleStage}
            />
            <EditableField
              label="Date Received"
              value={item?.date_recvd}
              fieldKey="date_recvd"
              onStage={handleStage}
            />
            <EditableField
              label="Description"
              value={item?.description}
              fieldKey="description"
              onStage={handleStage}
            />
          </Grid>
        </Collapse>

        {/* Boxes section — collapsible */}
        {item && (
          <>
            <Divider mb={3} />
            <Button
              size="xs"
              variant="ghost"
              color="gray.400"
              _hover={{ color: "gray.600" }}
              mb={boxesExpanded ? 2 : 0}
              onClick={() => {
                setBoxesExpanded((v) => !v);
                setAddingBox(false);
                setNewBoxWeight("");
                setLastRemovedBox(null);
              }}
            >
              {boxesExpanded
                ? "Hide Boxes"
                : `Boxes${itemBoxes.length > 0 ? ` (${itemBoxes.length})` : ""}`}
            </Button>
            <Collapse in={boxesExpanded} animateOpacity>
              <Box>
                {itemBoxes.length > 0 ? (
                  <Flex flexWrap="wrap" gap={1.5} mb={2}>
                    {itemBoxes.map((box, i) => (
                      <Flex
                        key={i}
                        align="center"
                        gap={1}
                        px={2}
                        py={0.5}
                        bg="gray.100"
                        borderRadius="full"
                        fontSize="xs"
                        color="gray.600"
                      >
                        <Text>{parseFloat(box.weight).toFixed(2)} lb</Text>
                        <Button
                          size="xs"
                          variant="ghost"
                          colorScheme="red"
                          minW="auto"
                          px={0.5}
                          h="auto"
                          lineHeight="1"
                          isLoading={boxLoading === i}
                          onClick={() => handleRemoveBox(i)}
                          _hover={{ color: "red.500" }}
                        >
                          ×
                        </Button>
                      </Flex>
                    ))}
                  </Flex>
                ) : (
                  <Text fontSize="xs" color="gray.400" mb={2}>
                    No boxes recorded
                  </Text>
                )}
                {lastRemovedBox && (
                  <Flex
                    align="center"
                    gap={2}
                    mb={2}
                    px={2}
                    py={1}
                    bg="orange.50"
                    borderRadius="md"
                    border="1px"
                    borderColor="orange.200"
                  >
                    <Text fontSize="xs" color="orange.700">
                      Removed {parseFloat(lastRemovedBox.weight).toFixed(2)} lb
                    </Text>
                    <Button
                      size="xs"
                      colorScheme="orange"
                      variant="solid"
                      borderRadius="md"
                      isLoading={boxLoading === "add"}
                      onClick={handleUndoRemove}
                    >
                      Undo
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      colorScheme="gray"
                      minW="auto"
                      px={1}
                      onClick={() => setLastRemovedBox(null)}
                    >
                      ✕
                    </Button>
                  </Flex>
                )}
                {addingBox ? (
                  <Flex gap={2} mb={2}>
                    <Input
                      size="xs"
                      placeholder="Weight (lb)"
                      value={newBoxWeight}
                      onChange={(e) => setNewBoxWeight(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddBox();
                      }}
                      borderRadius="md"
                      w="120px"
                      autoFocus
                    />
                    <Button
                      size="xs"
                      colorScheme="blue"
                      borderRadius="md"
                      isLoading={boxLoading === "add"}
                      onClick={handleAddBox}
                    >
                      Add
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      colorScheme="gray"
                      onClick={() => {
                        setAddingBox(false);
                        setNewBoxWeight("");
                      }}
                    >
                      Cancel
                    </Button>
                  </Flex>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    colorScheme="blue"
                    onClick={() => setAddingBox(true)}
                  >
                    + Add Box
                  </Button>
                )}
              </Box>
            </Collapse>
          </>
        )}

        <Flex gap={2} justify="space-between" align="center">
          <Button
            size="xs"
            variant="ghost"
            color="gray.400"
            _hover={{ color: "gray.600" }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Less" : "Full Details"}
          </Button>
          <Flex gap={2}>
            <Button
              size="xs"
              variant="outline"
              onClick={() => printDetails(item)}
            >
              Print
            </Button>
            <Button
              size="xs"
              colorScheme="orange"
              onClick={() => onLocate(item)}
            >
              Locate
            </Button>
            <Button size="xs" colorScheme="blue" onClick={() => onSet(item)}>
              Set
            </Button>
          </Flex>
        </Flex>
      </Box>
    </Collapse>
  );
};

export default DetailsPanel;
