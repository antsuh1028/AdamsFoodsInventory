// The sessions a merge would combine.

import { Box, Flex, Text } from "@chakra-ui/react";

const MemberSessions = ({ rows }) => (
  <Box>
    <Text fontSize="xs" fontWeight="600" color="gray.600" mb={1}
      textTransform="uppercase" letterSpacing="wide">
      Sessions it covered
    </Text>
    <Flex direction="column" gap={1}>
      {rows.map((m) => (
        <Flex key={m.batch_id} gap={3} align="baseline" wrap="wrap" fontSize="xs">
          <Text color="gray.500">#{m.batch_id}</Text>
          <Text color="gray.800" fontWeight="600">{m.lot_number || "—"}</Text>
          <Text color="gray.700">{m.vendor || "—"}</Text>
          <Text color="gray.600">{m.item_description || ""}</Text>
          {m.box_count != null && (
            <Text color="gray.500" ml="auto">
              {m.box_count} box{m.box_count === 1 ? "" : "es"}
            </Text>
          )}
        </Flex>
      ))}
    </Flex>
  </Box>
);

export { MemberSessions };
