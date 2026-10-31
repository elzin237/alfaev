import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks=vi.hoisted(()=>({gate:true,profile:'profile-one',allowed:true,projects:true,counts:vi.fn(),list:vi.fn(),ack:vi.fn(),receipt:vi.fn(),navigate:vi.fn(),legacyCount:vi.fn()}));
vi.mock('../../../app/config/activeAlertsV2Activation',()=>({isActiveAlertsV2Enabled:()=>mocks.gate}));
vi.mock('../../../app/auth/AuthProvider',()=>({useAuth:()=>({session:{user:{id:`auth-${mocks.profile}`},access_token:'test-token'},profile:{id:mocks.profile,authUserId:`auth-${mocks.profile}`,isActive:true},isActive:true,isAdmin:true,isLoading:false,error:null})}));
vi.mock('react-router',()=>({useNavigate:()=>mocks.navigate}));
vi.mock('../hooks/useProjectAlerts',async original=>({...await original<typeof import('../hooks/useProjectAlerts')>(),useProjectAlertAccess:()=>({profileId:mocks.profile,canRead:mocks.allowed,canReadProjects:mocks.allowed&&mocks.projects,canReadWorkOrders:mocks.allowed,permissionsPending:false,scope:mocks.allowed?(mocks.projects?'pw':'w'):''}),useProjectAlertUnreadCount:mocks.legacyCount}));
vi.mock('../services/activeAlertsV2Service',async original=>({...await original<typeof import('../services/activeAlertsV2Service')>(),getActiveProblemCountsV2:mocks.counts,listActiveAlertPageV2:mocks.list,acknowledgeProblemV2:mocks.ack,updateAlertReceiptV2:mocks.receipt}));
import DashboardAlertsControl from './DashboardAlertsControl';
import DashboardSidebarAlertBadge from './DashboardSidebarAlertBadge';
import type { AlertCondition, AlertPage, ActiveProblemCounts } from '../services/activeAlertsV2Service';
import { activeAlertBackend, activeAlertV2Prefix } from '../activeAlertsV2QueryKeys';

const stamp='2026-10-31T12:00:00Z';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function condition(kind:AlertCondition['kind']='project_shortage',patch:Partial<AlertCondition>={}):AlertCondition {
  const issue=kind==='project_issue'||kind==='informational_update';
  return {kind,id:id(1),status:kind==='informational_update'?'informational':'active',targetType:kind==='work_order_shortage'?'work_order':'project',targetId:id(2),targetLabel:kind==='work_order_shortage'?'RN-2026-0041':'Authorized Project',navigationAllowed:true,notificationId:id(3),deliveryCreatedAt:stamp,readAt:null,openedAt:stamp,resolvedAt:null,dismissedAt:null,acknowledgedAt:null,product:issue?null:{id:id(4),name:'Component',serial:'006'},shortageQuantity:issue?null:'9007199254740993.2500',issue:issue?{activityId:id(1),title:'Source activity',description:'Original issue or update context',authorId:id(5),authorName:'Authorized author',resolutionDescription:null,resolverId:null,resolverName:null}:null,...patch};
}
let counts:ActiveProblemCounts,activeRows:AlertCondition[],historyRows:AlertCondition[],updateRows:AlertCondition[],clients:QueryClient[]=[];
const page=(items:AlertCondition[],patch:Partial<AlertPage>={})=>({items,hasMore:false,nextCursor:null,asOf:stamp,...patch});
function setup(children:ReactNode=<><DashboardSidebarAlertBadge/><DashboardAlertsControl/></>) {
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});clients.push(client);
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return {...render(children,{wrapper}),client};
}
async function open(){const b=await screen.findByRole('button',{name:'Alerts, 3 active problems'});fireEvent.click(b);await screen.findByRole('list',{name:'Active Problems'});}
beforeEach(()=>{
  vi.clearAllMocks();mocks.gate=true;mocks.profile='profile-one';mocks.allowed=true;mocks.projects=true;
  counts={activeProblems:'3',workOrderShortages:'1',projectShortages:'1',projectIssues:'1',unreadUpdates:'8',asOf:stamp};
  activeRows=[condition(),condition('project_issue',{id:id(6)}),condition('work_order_shortage',{id:id(7),shortageQuantity:'42'})];historyRows=[];updateRows=[];
  mocks.counts.mockImplementation(async()=>({ok:true,value:{...counts}}));
  mocks.list.mockImplementation(async({feed})=>({ok:true,value:page(feed==='conditions'?activeRows:feed==='history'?historyRows:updateRows)}));
  mocks.receipt.mockImplementation(async(_action,item)=>{activeRows=activeRows.map(r=>r.id===item.id?{...r,readAt:stamp}:r);updateRows=updateRows.map(r=>r.id===item.id?{...r,readAt:stamp}:r);return {ok:true,value:{notificationId:item.notificationId,at:stamp}};});
  mocks.ack.mockResolvedValue({ok:true,value:{kind:'project_issue',id:id(1),acknowledgedAt:stamp}});
});
afterEach(()=>{cleanup();for(const c of clients)c.clear();clients=[];vi.restoreAllMocks();vi.unstubAllGlobals();});
it('uses the same exact active count on both surfaces, excludes updates, and never mounts legacy reads',async()=>{
  setup();await screen.findByRole('button',{name:'Alerts, 3 active problems'});expect(screen.getByLabelText('3 active problems')).toHaveTextContent('3');
  expect(mocks.legacyCount).not.toHaveBeenCalled();await open();
  expect(screen.getByRole('button',{name:'Updates (8 unread)'})).toBeInTheDocument();
  expect(screen.getAllByText('Active')).toHaveLength(3);expect(screen.queryByRole('button',{name:/Dismiss|Acknowledge/})).not.toBeInTheDocument();
  expect(screen.getByText('006 · Component — Shortage: 9007199254740993.2500')).toBeInTheDocument();
  expect(mocks.list.mock.calls.every(([r])=>r.feed==='conditions'&&r.status==='active')).toBe(true);
});
it.each(['project_shortage','project_issue','work_order_shortage'] as const)('reading %s keeps both badges and permits authorized source navigation',async kind=>{
  activeRows=[condition(kind,{shortageQuantity:kind==='work_order_shortage'?'9':kind==='project_shortage'?'1.5':null})];setup();await open();
  fireEvent.click(screen.getByRole('button',{name:'Mark read'}));await screen.findByText(/· Read/);
  expect(screen.getByRole('button',{name:'Alerts, 3 active problems'})).toHaveTextContent('3');expect(screen.getByLabelText('3 active problems')).toHaveTextContent('3');
  fireEvent.click(screen.getByRole('button',{name:kind==='work_order_shortage'?'Open Work Order':'Open Project'}));
  await waitFor(()=>expect(mocks.navigate).toHaveBeenCalledWith(kind==='work_order_shortage'?`/work-orders/${id(2)}`:`/projects/${id(2)}${kind==='project_issue'?`#activity-${id(1)}`:''}`));
  expect(mocks.receipt).toHaveBeenCalledTimes(1);
});
it('removes resolved conditions and decreases both badges only after authoritative refresh',async()=>{
  const {client}=setup();await open();activeRows=[];counts={...counts,activeProblems:'0',workOrderShortages:'0',projectShortages:'0',projectIssues:'0'};
  await act(async()=>{await client.invalidateQueries({queryKey:['dashboard','active-alerts-v2']});});
  await screen.findByText('No active problems.');expect(screen.queryByLabelText('3 active problems')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Alerts, 0 active problems'})).toHaveTextContent(/^Alerts$/);
});
it('keeps resolved and acknowledged conditions in History, with independent acknowledgment',async()=>{
  historyRows=[condition('project_issue',{status:'resolved',resolvedAt:stamp,readAt:stamp,issue:{...condition('project_issue').issue!,resolutionDescription:'Issue fixed',resolverId:id(9),resolverName:'Resolver'}})];
  mocks.ack.mockImplementation(async(kind,identity)=>{historyRows=historyRows.map(r=>({...r,acknowledgedAt:stamp}));return {ok:true,value:{kind,id:identity,acknowledgedAt:stamp}};});
  setup();await open();fireEvent.click(screen.getByRole('button',{name:'History'}));await screen.findByRole('button',{name:'Acknowledge'});expect(screen.getByText('Issue fixed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Acknowledge'}));await screen.findByText('Acknowledged');expect(screen.getByText('Authorized Project')).toBeInTheDocument();
  expect(mocks.ack).toHaveBeenCalledWith('project_issue',id(1),expect.objectContaining({accessToken:'test-token'}));expect(screen.getByLabelText('3 active problems')).toBeInTheDocument();
});
it('reads/dismisses only informational updates, preserving the active-problem badge',async()=>{
  updateRows=[condition('informational_update')];const {client}=setup();await open();fireEvent.click(screen.getByRole('button',{name:'Updates (8 unread)'}));await screen.findByText('Unread');
  fireEvent.click(screen.getByRole('button',{name:'Mark read'}));await screen.findByText('Read');
  mocks.receipt.mockImplementation(async(action,item)=>{updateRows=[];counts={...counts,unreadUpdates:'7'};return{ok:true,value:{notificationId:item.notificationId,at:stamp}};});
  fireEvent.click(screen.getByRole('button',{name:'Dismiss update'}));const dialog=screen.getByRole('dialog',{name:'Dismiss update?'});fireEvent.click(within(dialog).getByRole('button',{name:'Dismiss update'}));
  await screen.findByText('No updates.');expect(screen.getByRole('button',{name:'Updates (7 unread)'})).toBeInTheDocument();expect(screen.getByLabelText('3 active problems')).toBeInTheDocument();expect(mocks.ack).not.toHaveBeenCalled();
  expect(client.getQueryCache().getAll().some(q=>q.queryKey.includes('updates'))).toBe(true);
});
it('does not expose navigation without authoritative eligibility',async()=>{
  activeRows=[condition('project_issue',{navigationAllowed:false})];setup();await open();expect(screen.queryByRole('button',{name:'Open Project'})).not.toBeInTheDocument();
});
it('paginates with the authoritative cursor and preserves prior rows while loading more',async()=>{
  const cursor={beforeAt:stamp,beforeKind:'project_shortage' as const,beforeId:id(1)};let finish!:(v:any)=>void;
  mocks.list.mockImplementation(async({cursor:before})=>before?await new Promise(resolve=>{finish=resolve;}):{ok:true,value:page([condition()],{hasMore:true,nextCursor:cursor})});
  setup();await open();fireEvent.click(screen.getByRole('button',{name:'Load more'}));await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith({feed:'conditions',status:'active',cursor},expect.any(Object),expect.any(AbortSignal)));
  expect(screen.getByText('Authorized Project')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Loading…'})).toBeDisabled();
  await act(async()=>{finish({ok:true,value:page([condition('work_order_shortage',{id:id(8)})])});});await screen.findByText('RN-2026-0041');expect(screen.getByText('Authorized Project')).toBeInTheDocument();
});
it('shows unavailable counts and retryable feed errors without a stale red count',async()=>{
  mocks.counts.mockResolvedValue({ok:false,error:{code:'unavailable',message:'Unavailable'}});mocks.list.mockResolvedValue({ok:false,error:{code:'unavailable',message:'Unavailable'}});
  setup();const b=await screen.findByRole('button',{name:'Alerts, active problems unavailable'});expect(screen.queryByLabelText('3 active problems')).not.toBeInTheDocument();fireEvent.click(b);await screen.findByRole('button',{name:'Retry'});expect(screen.getByText(/Unable to load active problems/)).toBeInTheDocument();
});
it('hides stale content on profile/permission changes and supports keyboard close/focus return',async()=>{
  const r=setup();await open();fireEvent.keyDown(document,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());await waitFor(()=>expect(screen.getByRole('button',{name:'Alerts, 3 active problems'})).toHaveFocus());
  await open();const oldPrefix=activeAlertV2Prefix({backendOrigin:activeAlertBackend(),authUserId:'auth-profile-one',profileId:'profile-one',permissions:'pw'});
  mocks.profile='profile-two';mocks.allowed=false;r.rerender(<><DashboardSidebarAlertBadge/><DashboardAlertsControl/></>);expect(screen.queryByText('Authorized Project')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Alerts,/})).not.toBeInTheDocument();
  expect(r.client.getQueriesData({queryKey:oldPrefix})).toHaveLength(0);
});
it('prevents duplicate submission and shows a failed receipt without removing the active condition',async()=>{
  let finish!:(v:any)=>void;mocks.receipt.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));activeRows=[condition()];setup();await open();const read=screen.getByRole('button',{name:'Mark read'});fireEvent.click(read);fireEvent.click(read);await waitFor(()=>expect(mocks.receipt).toHaveBeenCalledTimes(1));
  await act(async()=>{finish({ok:false,error:{code:'unavailable',message:'Retry read safely.'}});});await screen.findByText('Retry read safely.');expect(screen.getByText('Active')).toBeInTheDocument();expect(screen.getByLabelText('3 active problems')).toBeInTheDocument();
});
it('caps very large counts at 99+ without Number conversion',async()=>{
  counts={...counts,activeProblems:'9007199254740993'};setup();await screen.findByRole('button',{name:'Alerts, 9007199254740993 active problems'});expect(screen.getAllByText('99+')).toHaveLength(2);
});
it('gate OFF keeps the legacy sidebar badge and makes no v2 calls',()=>{
  mocks.gate=false;mocks.legacyCount.mockReturnValue({access:{canRead:true,permissionsPending:false},unreadCountQuery:{isError:false,data:{exactValue:1n,projectUnread:2n,hasUnread:true,displayValue:'1'}}});
  setup(<DashboardSidebarAlertBadge/>);expect(mocks.legacyCount).toHaveBeenCalled();expect(mocks.counts).not.toHaveBeenCalled();expect(mocks.list).not.toHaveBeenCalled();expect(screen.getByText(/^[13]$/)).toBeInTheDocument();
});
it('Work Order-only recipients do not see Project Updates or Project rows',async()=>{
  mocks.projects=false;counts={...counts,activeProblems:'1',projectShortages:'0',projectIssues:'0',unreadUpdates:'0'};setup();fireEvent.click(await screen.findByRole('button',{name:'Alerts, 1 active problems'}));await screen.findByRole('list',{name:'Active Problems'});expect(screen.queryByRole('button',{name:/Updates/})).not.toBeInTheDocument();
  expect(screen.queryByText('Authorized Project')).not.toBeInTheDocument();expect(screen.getByText('RN-2026-0041')).toBeInTheDocument();
});
it('initial pending feeds remain bounded and show a loading state',async()=>{
  mocks.list.mockReturnValue(new Promise(()=>{}));setup();fireEvent.click(await screen.findByRole('button',{name:'Alerts, 3 active problems'}));
  expect(screen.getByText('Loading alerts…')).toBeInTheDocument();expect(mocks.list).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:'Load more'})).not.toBeInTheDocument();
});
it('keeps verified rows on a continuation failure and retries the same bounded cursor',async()=>{
  const cursor={beforeAt:stamp,beforeKind:'project_shortage' as const,beforeId:id(1)};
  mocks.list.mockImplementation(async({cursor:before})=>before?{ok:false,error:{code:'unavailable',message:'Retry'}}:{ok:true,value:page([condition()],{hasMore:true,nextCursor:cursor})});
  setup();await open();fireEvent.click(screen.getByRole('button',{name:'Load more'}));await screen.findByRole('button',{name:'Retry more alerts'});expect(screen.getByText('Authorized Project')).toBeInTheDocument();
  mocks.list.mockResolvedValue({ok:true,value:page([condition('work_order_shortage',{id:id(8)})])});fireEvent.click(screen.getByRole('button',{name:'Retry more alerts'}));await screen.findByText('RN-2026-0041');
  expect(mocks.list).toHaveBeenLastCalledWith({feed:'conditions',status:'active',cursor},expect.any(Object),expect.any(AbortSignal));
});
it('bounds the panel inside a narrow viewport and repositions on resize',async()=>{
  vi.stubGlobal('innerWidth',375);vi.stubGlobal('innerHeight',800);
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    const rect=this.tagName==='SECTION'?{left:0,top:0,right:351,bottom:600,width:351,height:600}:{left:280,top:700,right:360,bottom:744,width:80,height:44};
    return {...rect,x:rect.left,y:rect.top,toJSON:()=>rect};
  });
  setup();await open();const dialog=screen.getByRole('dialog',{name:'Alerts'});expect(dialog).toHaveStyle({left:'12px',top:'188px'});
  expect(dialog.className).toContain('calc(100vw-1.5rem)');expect(within(dialog).getByRole('list',{name:'Active Problems'}).parentElement?.className).toContain('overflow-y-auto');
  vi.stubGlobal('innerHeight',700);fireEvent(window,new Event('resize'));expect(dialog).toHaveStyle({top:'88px'});
});
