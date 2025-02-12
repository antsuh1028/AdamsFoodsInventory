function getLocations(lst) {
  return lst
    .filter((item) => item.location && item.location.trim() !== "")
    .map((item) => item.location);
}

export default getLocations;
