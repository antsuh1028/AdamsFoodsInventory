import { createIcon } from "@chakra-ui/icons";

// The pop-out icon reversed: an arrow into the box, for bringing a window back onto the page.
const PopInIcon = createIcon({
  displayName: "PopInIcon",
  viewBox: "0 0 24 24",
  path: (
    <g fill="currentColor">
      <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7z" />
      <path d="M21 4.41 19.59 3 13 9.59V6h-2v7h7v-2h-3.59z" />
    </g>
  ),
});

export default PopInIcon;
