import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
const mocks = vi.hoisted(() => ({ auth:vi.fn() }));
vi.mock("../../app/auth/AuthProvider", () => ({ useAuth:mocks.auth }));
import { ApplicationHeaderProvider, useApplicationHeader, useApplicationHeaderLabel } from "./ApplicationHeaderContext";
const auth = { isActive:true, isLoading:false, error:null, isAdmin:false, session:{ user:{id:"actor-one"} }, profile:{id:"profile-one",authUserId:"actor-one",isActive:true} };
function Reader() { const header=useApplicationHeader();return <header><h2>{header.title}</h2><p>{header.subtitle}</p></header>; }
function Detail({label}:{label:string|null}) {useApplicationHeaderLabel(label);return <p>Authorized detail</p>;}
function Controls(){const navigate=useNavigate();return <><button onClick={()=>navigate("/inventory?warehouse=customs")}>Inventory</button><button onClick={()=>navigate("/projects/second")}>Second</button><button onClick={()=>navigate(-1)}>Back</button><button onClick={()=>navigate(1)}>Forward</button></>;}
function Harness({entry="/projects/first",label="Project: Authorized name",allowed=true}:{entry?:string;label?:string|null;allowed?:boolean}){
  return <MemoryRouter initialEntries={[entry]}><ApplicationHeaderProvider><Reader/><Controls/><Routes><Route path="/projects/:id" element={allowed?<Detail label={label}/>:<p>Access denied</p>}/><Route path="*" element={<p>Module screen</p>}/></Routes></ApplicationHeaderProvider></MemoryRouter>;
}
beforeEach(()=>mocks.auth.mockReturnValue(auth));afterEach(cleanup);
it("uses a successful mounted page's authorized label without duplicating its large heading",()=>{
  render(<Harness/>);expect(screen.getByRole("heading",{name:"Projects"})).toBeInTheDocument();expect(screen.getByText("Project: Authorized name")).toBeInTheDocument();
});
it("updates on navigation and browser back/forward without retaining another route's name",()=>{
  render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"Inventory"}));expect(screen.getByRole("heading",{name:"Inventory"})).toBeInTheDocument();expect(screen.getByText("Materials and stock management.")).toBeInTheDocument();expect(screen.queryByText("Project: Authorized name")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Back"}));expect(screen.getByText("Project: Authorized name")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Forward"}));expect(screen.queryByText("Project: Authorized name")).not.toBeInTheDocument();
});
it("clears a denied screen's context and uses the module fallback",()=>{
  const r=render(<Harness/>);r.rerender(<Harness allowed={false}/>);expect(screen.getByText("Access denied")).toBeInTheDocument();expect(screen.queryByText("Project: Authorized name")).not.toBeInTheDocument();expect(screen.getByText("Project details and delivery planning.")).toBeInTheDocument();
});
it("never rebinds an unchanged previous profile's label; revalidation can publish fresh context",()=>{
  const r=render(<Harness/>);mocks.auth.mockReturnValue({...auth,session:{user:{id:"actor-two"}},profile:{id:"profile-two",authUserId:"actor-two",isActive:true}});r.rerender(<Harness/>);expect(screen.queryByText("Project: Authorized name")).not.toBeInTheDocument();
  r.rerender(<Harness label={null}/>);r.rerender(<Harness label="Project: Newly authorized"/>);expect(screen.getByText("Project: Newly authorized")).toBeInTheDocument();
});
it.each(["inactive","incoherent","pending","error"])("does not display contextual data for %s authentication",state=>{
  mocks.auth.mockReturnValue({...auth,...(state==="inactive"?{isActive:false}:state==="pending"?{isLoading:true}:state==="error"?{error:{message:"Denied"}}:{profile:{...auth.profile,authUserId:"different"}})});
  render(<Harness/>);expect(screen.queryByText("Project: Authorized name")).not.toBeInTheDocument();
});
it("isolates role changes and does not reuse stale Admin context",()=>{
  mocks.auth.mockReturnValue({...auth,isAdmin:true});const r=render(<Harness/>);mocks.auth.mockReturnValue(auth);r.rerender(<Harness/>);expect(screen.queryByText("Project: Authorized name")).not.toBeInTheDocument();
});
it.each(["/work-orders/new","/pcb/test","/archive","/users","/settings","/missing"])("handles direct non-detail navigation to %s",entry=>{
  render(<Harness entry={entry}/>);expect(screen.queryByText("Project: Authorized name")).not.toBeInTheDocument();expect(screen.queryByRole("heading",{name:"Dashboard"})).not.toBeInTheDocument();
});
it("clears context during loading/error and restores fresh data",()=>{
  const r=render(<Harness/>);r.rerender(<Harness label={null}/>);expect(screen.queryByText("Project: Authorized name")).not.toBeInTheDocument();r.rerender(<Harness label="Project: Reloaded"/>);expect(screen.getByText("Project: Reloaded")).toBeInTheDocument();
});
