import './App.css';
import { Route, Routes } from 'react-router-dom';
import { ChakraProvider } from '@chakra-ui/react'
import Homescreen from './pages/Homescreen'
import Login from './pages/Login';
import Signup from './pages/Signup'
import Loading from './pages/Loading';

function App() {
  return (
    <ChakraProvider>
        <Routes>
          <Route path="/" element={<Login />} />  
          <Route path="/home" element={<Homescreen />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/loading..." element={<Loading />} />
        </Routes>
    </ChakraProvider>
  );
}

export default App;
