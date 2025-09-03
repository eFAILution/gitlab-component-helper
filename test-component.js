const { ComponentService } = require('./out/src/services/componentService.js');

async function testComponent() {
  try {
    const service = new ComponentService();
    const comp = await service.getComponentFromUrl('https://gitlab.com/components/opentofu/full-pipeline@main');

    console.log('Component name:', comp.name);
    console.log('Component description:', comp.description);
    console.log('Has README:', !!comp.readme);
    console.log('README length:', comp.readme ? comp.readme.length : 0);

    if (comp.description === 'Component/Project does not have a description') {
      console.log('✅ Fallback description is working');
    } else {
      console.log('❌ Using project description:', comp.description.substring(0, 100) + '...');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testComponent();
