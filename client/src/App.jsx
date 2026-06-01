import { Route, Routes } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import Homescreen from "./pages/Homescreen";
import NoblesseScreen from "./pages/NoblesseScreen";
import Login from "./pages/Login";
import NoblesseLogin from "./pages/NoblesseLogin";
import Loading from "./pages/Loading";
import PrivateRoute from "./PrivateRoute";

function App() {
  return (
    <ChakraProvider>
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
