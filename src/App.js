import './App.css';
import { Route, Routes } from 'react-router-dom';
import { ChakraProvider } from '@chakra-ui/react'
import Homescreen from './pages/Homescreen'
import Login from './pages/Login';
import Signup from './pages/Signup'

function App() {
  return (
    <ChakraProvider>
        <Routes>
          <Route path="/" element={<Homescreen />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
        </Routes>
    </ChakraProvider>
  );
}

export default App;
