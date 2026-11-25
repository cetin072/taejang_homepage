(() => {
  // One private server contract; basic HR owns both display and editing.
  window.TaejangEmployeeRemoteWork = {
    load: employee => window.TaejangApp.rpc('get_employee_remote_work_location', { p_employee_uuid: employee.id })
  };
})();
