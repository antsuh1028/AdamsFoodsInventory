import { Route, Routes } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import Homescreen from "./pages/Homescreen";
import Login from "./pages/Login";
import Loading from "./pages/Loading";
import PrivateRoute from "./PrivateRoute";

function App() {
  return (
    <ChakraProvider>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/loading..." element={<Loading />} />

        <Route 
          path="/home" 
          element={
            <PrivateRoute>
              <Homescreen />
            </PrivateRoute>
          } 
        />
      </Routes>
    </ChakraProvider>
  );
}

export default App;
