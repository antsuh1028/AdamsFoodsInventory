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
const theme = extendTheme({
  colors: {
    orange: base.colors.yellow,
    purple: base.colors.blue,
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
