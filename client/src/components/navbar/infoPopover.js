import { useContext, useState, useEffect } from "react";
import { Box, Button, HStack, Text, Divider, Collapse, Grid } from "@chakra-ui/react";
import { FormContext } from "../../utils/homescreen/formContext";
import printDetails from "../../utils/printDetails";

const InfoPopover = ({
  info,
  position,
  onClose,
  onModalClose,
}) => {
  const { setFormData, setCurrentItem } = useContext(FormContext);
  const [selectedPrint, setSelectedPrint] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setSelectedPrint(null);
    setExpanded(false);
  }, [info]);

  if (!info || !info.length) return null;

  const isEmpty = info[0]?.description === "Empty Location";

  const handleSet = (item) => {
    setFormData({
      location: item.location || "",
      lot: item.lot || "",
      vendor: item.vendor || "",
      brand: item.brand || "",
      species: item.species || "",
      description: item.description === "Empty Location" ? "" : item.description || "",
      grade: item.grade || "",
      quantity: item.quantity || "",
      weight: item.weight || "",
      packdate: item.packdate || "",
      date_recvd: item.date_recvd || "",
      est: item.est || "",
    });
    setCurrentItem(item);
    onClose();
    onModalClose();
  };

  return (
    <Box
      position="fixed"
      left={position.x}
      top={position.y}
      bg="white"
      boxShadow="xl"
      border="1px"
      borderColor="gray.200"
      borderRadius="lg"
      p={3}
      zIndex={1400}
      maxHeight="50vh"
      width="220px"
      overflowY="auto"
      data-popover="true"
      transform={`translate(${
        position.x > window.innerWidth / 2 ? "-100%" : "0"
      }, ${position.y > window.innerHeight / 2 ? "-100%" : "0"})`}
    >
      {/* Header */}
      <HStack justify="space-between" mb={2}>
        <Text fontWeight="semibold" fontSize="sm" color="gray.700">
          {isEmpty ? info[0].location : `${info.length} item${info.length > 1 ? "s" : ""}`}
        </Text>
        <Button
          size="xs"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          color="gray.400"
          minW="auto"
          p={1}
          _hover={{ color: "gray.700" }}
        >
          ✕
        </Button>
      </HStack>

      <Divider mb={2} />

      {/* Content */}
      {isEmpty ? (
        <Text fontSize="xs" color="gray.400" textAlign="center" py={2}>
          Empty location
        </Text>
      ) : (
        <Box>
          {info.map((item, index) => (
            <Box
              key={`${item.location}-${index}`}
              mb={index < info.length - 1 ? 2 : 0}
              p={1.5}
              borderRadius="md"
              border="1px"
              borderColor={selectedPrint === item ? "blue.300" : "gray.100"}
              bg={selectedPrint === item ? "blue.50" : "gray.50"}
              _hover={{ borderColor: "blue.200", cursor: "pointer" }}
              onClick={() => setSelectedPrint(item)}
            >
              <HStack justify="space-between" mb={0.5}>
                <Text fontSize="xs" fontWeight="semibold" color="gray.600">
                  {item.location}
                </Text>
                <Text fontSize="xs" color="gray.500">
                  Qty: {item.quantity}
                </Text>
              </HStack>
              <Text fontSize="xs" color="gray.800" fontWeight="medium" noOfLines={1}>
                {item.description}
              </Text>
              <HStack mt={0.5} spacing={2}>
                <Text fontSize="xs" color="gray.500">
                  {item.brand}
                </Text>
                {item.grade && (
                  <Text fontSize="xs" color="gray.400">
                    · {item.grade}
                  </Text>
                )}
              </HStack>
              {item.lot && (
                <Text fontSize="xs" color="gray.400">
                  Lot: {item.lot}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Full Details */}
      {!isEmpty && (
        <>
          <Collapse in={expanded} animateOpacity>
            <Divider my={2} />
            {(() => {
              const item = selectedPrint || info[0];
              return (
                <Grid templateColumns="1fr 1fr" gap={2} mb={1}>
                  {item.vendor && (
                    <Box>
                      <Text fontSize="10px" color="gray.400" textTransform="uppercase" fontWeight="medium">Vendor</Text>
                      <Text fontSize="xs" color="gray.700" fontWeight="medium">{item.vendor}</Text>
                    </Box>
                  )}
                  {item.species && (
                    <Box>
                      <Text fontSize="10px" color="gray.400" textTransform="uppercase" fontWeight="medium">Species</Text>
                      <Text fontSize="xs" color="gray.700" fontWeight="medium">{item.species}</Text>
                    </Box>
                  )}
                  {item.weight && (
                    <Box>
                      <Text fontSize="10px" color="gray.400" textTransform="uppercase" fontWeight="medium">Weight</Text>
                      <Text fontSize="xs" color="gray.700" fontWeight="medium">{item.weight} lb</Text>
                    </Box>
                  )}
                  {item.est && (
                    <Box>
                      <Text fontSize="10px" color="gray.400" textTransform="uppercase" fontWeight="medium">EST #</Text>
                      <Text fontSize="xs" color="gray.700" fontWeight="medium">{item.est}</Text>
                    </Box>
                  )}
                  {item.packdate && (
                    <Box>
                      <Text fontSize="10px" color="gray.400" textTransform="uppercase" fontWeight="medium">Pack Date</Text>
                      <Text fontSize="xs" color="gray.700" fontWeight="medium">{item.packdate}</Text>
                    </Box>
                  )}
                  {item.date_recvd && (
                    <Box>
                      <Text fontSize="10px" color="gray.400" textTransform="uppercase" fontWeight="medium">Date Recv'd</Text>
                      <Text fontSize="xs" color="gray.700" fontWeight="medium">{item.date_recvd}</Text>
                    </Box>
                  )}
                </Grid>
              );
            })()}
          </Collapse>
          <Button
            size="xs"
            variant="ghost"
            colorScheme="blue"
            w="full"
            mt={1}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Less" : "Full Details"}
          </Button>
        </>
      )}

      {/* Footer */}
      <HStack mt={2} spacing={2}>
        <Button
          size="xs"
          colorScheme="blue"
          flex={1}
          onClick={() => handleSet(selectedPrint || info[0])}
        >
          Set
        </Button>
        <Button
          size="xs"
          variant="outline"
          flex={1}
          onClick={() => printDetails(selectedPrint || info[0])}
          isDisabled={isEmpty}
        >
          Print
        </Button>
      </HStack>
    </Box>
  );
};

export default InfoPopover;
