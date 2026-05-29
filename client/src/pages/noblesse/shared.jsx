import { Box } from "@chakra-ui/react";

export const today = () => new Date().toISOString().slice(0, 10);

export const fmtDate = (val) => {
  if (!val) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(val))) {
    const [y, m, d] = String(val).split("-");
    return `${parseInt(m)}/${parseInt(d)}/${y}`;
  }
  const dt = new Date(val);
  if (isNaN(dt)) return String(val);
  const mo = dt.getMonth() + 1;
  const d  = dt.getDate();
  const y  = dt.getFullYear();
  const h  = dt.getHours() % 12 || 12;
  const min  = String(dt.getMinutes()).padStart(2, "0");
  const ampm = dt.getHours() >= 12 ? "PM" : "AM";
  return `${mo}/${d}/${y} - ${h}:${min} ${ampm}`;
};

export const cellInputStyle = {
  width: "100%", fontSize: "12px", padding: "2px 5px",
  border: "1px solid #A0AEC0", borderRadius: "3px",
  outline: "none", background: "white", fontFamily: "inherit",
};

export const Th = ({ children, ...props }) => (
  <Box
    as="th" px={3} py={2} textAlign="left"
    fontSize="xs" fontWeight="semibold" color="gray.500"
    textTransform="uppercase" letterSpacing="wide"
    bg="gray.50" borderBottom="2px" borderColor="gray.200"
    whiteSpace="nowrap" {...props}
  >
    {children}
  </Box>
);

export const Td = ({ children, ...props }) => (
  <Box
    as="td" px={3} py={2}
    fontSize="sm" color="gray.700"
    borderBottom="1px" borderColor="gray.100"
    whiteSpace="nowrap" {...props}
  >
    {children}
  </Box>
);
