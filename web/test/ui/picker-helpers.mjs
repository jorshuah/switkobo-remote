export async function choose(page,label,value){
 const picker=page.getByRole('combobox',{name:label,exact:true});const id=await picker.getAttribute('data-select-id');
 const text=await page.locator('#'+id).evaluate((select,value)=>[...select.options].find(o=>o.value===value)?.label,value);
 if(text===undefined)throw Error('No option '+value+' in '+label);await picker.click();await page.getByRole('listbox',{name:label,exact:true}).getByRole('option',{name:text,exact:true}).click();
}
