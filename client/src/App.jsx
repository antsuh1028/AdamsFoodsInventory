import { Route, Routes } from "react-router-dom";
import { ChakraProvider, extendTheme, theme as base } from "@chakra-ui/react";
import Homescreen from "./pages/Homescreen";
import NoblesseScreen from "./pages/NoblesseScreen";
import Login from "./pages/Login";
import NoblesseLogin from "./pages/NoblesseLogin";
import Loading from "./pages/Loading";
import PrivateRoute from "./PrivateRoute";

// This app has no orange and no purple in it.
//
// Every explicit use was removed from the source, but two of Chakra's own
// semantic statuses reach for them regardless of what we write:
//
//   <Alert status="warning">  ->  orange
//   <Alert status="error">    ->  red      (kept, that one is on theme)
//
// So the two scales are re-pointed here rather than every `status="warning"`
// being rewritten to something less meaningful. A warning still reads as a
// warning; it just lands in the app's palette — yellow, which is already the
// in-progress colour — instead of introducing a hue that belongs to nothing
// else on the screen.
//
// Doing it in one place also means a `status="warning"` written later cannot
// quietly bring orange back.
//
// Re-pointing the scale is not quite enough for TOASTS. Inline alerts render
// the `subtle` variant (a light tint), but a toast renders `solid`, which
// reaches for the 600 step — yellow.600 is #B7791F, a brown that still reads
// orange. So a solid warning is given a real yellow with dark text instead.
const solid = base.components.Alert.variants.solid;

const theme = extendTheme({
  colors: {
    orange: base.colors.yellow,
    purple: base.colors.blue,
  },
  styles: {
    global: {
      // iOS Safari ZOOMS THE WHOLE PAGE IN when a field smaller than 16px takes
      // focus, and it never zooms back out. This app uses size="sm" inputs
      // almost everywhere, so on a tablet every tap into a form left the
      // operator dragging a magnified page sideways to find the next field.
      //
      // Set once for touch devices rather than on ~48 call sites, and scoped to
      // `pointer: coarse` so the dense desktop layouts are untouched.
      "@media (pointer: coarse)": {
        "input, select, textarea": { fontSize: "16px !important" },
      },
    },
  },
  components: {
    Alert: {
      variants: {
        solid: (props) => {
          const styles = solid(props);
          // 'orange' is what status="warning" resolves to, remap or no remap.
          if (props.colorScheme !== "orange") return styles;
          const fg = { "--alert-fg": "colors.gray.900", "--alert-bg": "colors.yellow.300" };
          return {
            ...styles,
            container: { ...styles.container, ...fg, _dark: fg, color: "var(--alert-fg)" },
          };
        },
      },
    },
  },
});

function App() {
  return (
    <ChakraProvider theme={theme}>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/noblesse-login" element={<NoblesseLogin />} />
        <Route path="/loading..." element={<Loading />} />

        <Route
          path="/home"
          element={
            <PrivateRoute allowedRoles={["admin", "manager", "user"]}>
              <Homescreen />
            </PrivateRoute>
          }
        />

        <Route
          path="/noblesse"
          element={
            <PrivateRoute allowedRoles={["admin", "noblesse"]}>
              <NoblesseScreen />
            </PrivateRoute>
          }
        />
      </Routes>
    </ChakraProvider>
  );
}

export default App;
