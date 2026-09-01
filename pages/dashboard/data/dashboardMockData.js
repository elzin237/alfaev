import {
  FolderKanban,
  ShoppingCart,
  Factory,
  Clock3,
  TriangleAlert,
} from "lucide-react";

export const stats = [
  {
    id: 1,
    title: "Aktivni projekti",
    value: 12,
    icon: FolderKanban,
    variant: "light",
  },
  {
    id: 2,
    title: "Otvorene nabavke",
    value: 17,
    icon: ShoppingCart,
    variant: "dark",
  },
  {
    id: 3,
    title: "Proizvodnja u toku",
    value: 23,
    icon: Factory,
    variant: "light",
  },
  {
    id: 4,
    title: "Kašnjenja",
    value: 2,
    icon: Clock3,
    variant: "dark",
  },
  {
    id: 5,
    title: "Kritični materijali",
    value: 5,
    icon: TriangleAlert,
    variant: "light",
  },
];

export const projects = [
  {
    id: "PROJ-2026-001",
    name: "SSP Pult 05",
    client: "Željeznice RS",
    progress: 35,
    status: "Nabavka",
    deliveryDate: "20.06.2026.",
    image: "/images/projects/ssp-pult.webp",
    step: 1,
  },
  {
    id: "PROJ-2026-002",
    name: "MTW Pult 02",
    client: "ŽFBH",
    progress: 70,
    status: "Montaža",
    deliveryDate: "05.07.2026.",
    image: "/images/projects/mtw-pult.webp",
    step: 4,
  },
  {
    id: "PROJ-2026-003",
    name: "EK-553 Kartice",
    client: "Interno",
    progress: 90,
    status: "Testiranje",
    deliveryDate: "15.06.2026.",
    image: "/images/projects/ek553.webp",
    step: 5,
  },
  {
    id: "PROJ-2026-004",
    name: "Komandni Ormar 01",
    client: "Željeznice RS",
    progress: 25,
    status: "Projektovanje",
    deliveryDate: "30.06.2026.",
    image: "/images/projects/ormar.webp",
    step: 0,
  },
  {
    id: "PROJ-2026-005",
    name: "SSP Pult 03",
    client: "Željeznice CG",
    progress: 50,
    status: "Izrada",
    deliveryDate: "10.07.2026.",
    image: "/images/projects/ssp-pult-03.webp",
    step: 1,
  },
];

export const alerts = [
  {
    id: 1,
    title: "Nedostatak materijala",
    description: "Phoenix Contact konektor 16 pin",
    meta: "Dostupno: 0 kom",
    level: "critical",
    time: "prije 15 min",
  },
  {
    id: 2,
    title: "Rok projekta MTW Pult 02",
    description: "Preostalo 4 dana do roka isporuke",
    meta: "",
    level: "critical",
    time: "prije 1 h",
  },
  {
    id: 3,
    title: "Revizija dokumenta na čekanju",
    description: "EK-553P Rev. C čeka odobrenje",
    meta: "Odgovoran: Ahmed K.",
    level: "document",
    time: "prije 2 h",
  },
  {
    id: 4,
    title: "Radni nalog na čekanju",
    description: "RN-1543 | Montaža SSP Pult 05",
    meta: "Čeka početak",
    level: "task",
    time: "prije 5 h",
  },
];

export const inventory = [
  {
    id: 1,
    item: "Phoenix Contact konektor 16 pin",
    stock: 0,
    minimum: 10,
    status: "Kritično",
  },
  {
    id: 2,
    item: "Kabal 0.75 mm²",
    stock: 12,
    minimum: 100,
    status: "Kritično",
  },
  {
    id: 3,
    item: "LED Signalna 24V",
    stock: 6,
    minimum: 20,
    status: "Nedovoljno",
  },
  {
    id: 4,
    item: "Relej Finder 24V",
    stock: 43,
    minimum: 20,
    status: "U redu",
  },
];

export const recentActivities = [
  {
    id: 1,
    user: "Admin",
    action: "Kreiran novi projekat",
    target: "SSP Pult 05",
    time: "09:12",
  },
  {
    id: 2,
    user: "Nabavka",
    action: "Poslat zahtjev",
    target: "Phoenix Contact",
    time: "10:25",
  },
  {
    id: 3,
    user: "Proizvodnja",
    action: "Završen radni nalog",
    target: "RN-1538",
    time: "11:03",
  },
  {
    id: 4,
    user: "Kontrola",
    action: "Odobrena revizija",
    target: "EK-553P Rev. C",
    time: "12:18",
  },
];

export const workOrders = [
  {
    id: "RN-1541",
    project: "SSP Pult 05",
    priority: "Visok",
    status: "U toku",
  },
  {
    id: "RN-1542",
    project: "MTW Pult 02",
    priority: "Srednji",
    status: "Planiran",
  },
  {
    id: "RN-1543",
    project: "EK-553 Kartice",
    priority: "Visok",
    status: "Na čekanju",
  },
];

export const procurementRequests = [
  {
    id: "PR-201",
    supplier: "Phoenix Contact",
    value: "4.200 KM",
    status: "Na odobrenju",
  },
  {
    id: "PR-202",
    supplier: "Siemens",
    value: "8.750 KM",
    status: "Poslano",
  },
  {
    id: "PR-203",
    supplier: "Schneider Electric",
    value: "2.100 KM",
    status: "Priprema",
  },
];
